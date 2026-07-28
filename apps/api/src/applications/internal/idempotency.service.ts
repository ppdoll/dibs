import { ConflictException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import type { Tx } from './application-context';

/** 진행 중인 요청에 돌려줄 재시도 간격(초). */
const RETRY_AFTER_SECONDS = 2;

export interface IdempotencyKeyRef {
  userId: string;
  endpoint: string;
  key: string;
  requestHash: string;
}

export interface StoredResponse {
  status: number;
  body: unknown;
}

/**
 * 멱등 레코드 저장소. (IC-03)
 *
 * 저장소가 Postgres 인 것이 이 규칙의 핵심이다. Vercel KV 로 빼면 `claimedCount` 를 올리는
 * 트랜잭션에 참여할 수 없어서 "KV 에는 기록됐는데 DB 는 롤백된" 상태 —
 * 영구 유령 성공 — 이 만들어진다. 상호배제 장치는 별도의 락이 아니라
 * `(userId, endpoint, key)` 복합 PK 의 INSERT 그 자체다.
 *
 * 프로토콜은 넷이다.
 *  - 삽입 성공                       → 처음 보는 요청. 도메인 로직을 돌리고 같은 트랜잭션에서 응답을 채운다.
 *  - 충돌 + 해시 같음 + completedAt   → 저장된 응답을 그대로 재생.
 *  - 충돌 + 해시 같음 + completedAt X → 아직 진행 중. 409 + Retry-After.
 *  - 충돌 + 해시 다름                 → 재생이 아니라 키 재사용이다. 422.
 *    (409 가 아닌 이유: 재시도로 풀리는 상황이 아니다. 클라이언트가 키를 새로 만들어야 한다.)
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 요청 본문의 정규화 해시.
   *
   * 키 순서에 흔들리지 않도록 정렬해서 직렬화한다 — 같은 요청을 재시도했는데
   * JSON 키 순서가 달라졌다는 이유로 422 를 받으면 그건 우리 버그다.
   */
  hashRequest(payload: unknown): string {
    return createHash('sha256').update(canonicalize(payload)).digest('hex');
  }

  /**
   * 트랜잭션을 열기 **전에** 완료된 응답이 있는지 본다.
   *
   * 이 빠른 경로가 없으면 IC-03 이 막으려던 시나리오가 그대로 남는다:
   * 마감 직전에 성공한 상향의 재시도가 도착했을 때, 트랜잭션 안에서 먼저 도는
   * IC-11 의 `FOR SHARE` 게이트가 "이미 마감됨(409)"으로 튕겨버린다.
   * 이미 성공한 요청은 이벤트 상태와 무관하게 그때의 응답을 받아야 한다.
   */
  async findCompleted(ref: IdempotencyKeyRef): Promise<StoredResponse | null> {
    const record = await this.prisma.idempotencyRecord.findUnique({
      where: {
        userId_endpoint_key: { userId: ref.userId, endpoint: ref.endpoint, key: ref.key },
      },
      select: { requestHash: true, responseStatus: true, responseBody: true, completedAt: true },
    });

    if (!record || record.completedAt === null) return null;

    assertSameRequest(record.requestHash, ref.requestHash);

    return { status: record.responseStatus ?? HttpStatus.OK, body: record.responseBody };
  }

  /**
   * 트랜잭션 안에서 키를 선점한다. `null` 을 돌려주면 처음 보는 요청이라는 뜻이다.
   *
   * `ON CONFLICT DO NOTHING` 은 충돌한 행을 만든 트랜잭션이 끝날 때까지 **기다린다**.
   * 그 대기가 곧 상호배제다 — 동시에 도착한 같은 키 두 개 중 하나는 반드시 뒤에 서고,
   * 앞선 쪽이 커밋했다면 그 응답을 재생하게 된다.
   */
  async claim(tx: Tx, ref: IdempotencyKeyRef): Promise<StoredResponse | null> {
    const inserted = await tx.$executeRaw`
      INSERT INTO "IdempotencyRecord"
        ("userId","endpoint","key","requestHash","lockedAt","expiresAt")
      VALUES (${ref.userId}, ${ref.endpoint}, ${ref.key}, ${ref.requestHash},
              now(), now() + interval '24 hours')
      ON CONFLICT ("userId","endpoint","key") DO NOTHING
    `;

    if (inserted === 1) return null;

    const [existing] = await tx.$queryRaw<
      { requestHash: string; responseStatus: number | null; responseBody: unknown; completedAt: Date | null }[]
    >`
      SELECT "requestHash", "responseStatus", "responseBody", "completedAt"
      FROM "IdempotencyRecord"
      WHERE "userId" = ${ref.userId} AND "endpoint" = ${ref.endpoint} AND "key" = ${ref.key}
    `;

    // 여기서 행이 없다는 건 앞선 트랜잭션이 롤백됐다는 뜻이다. 우리 INSERT 도 이미
    // 실패한 뒤라 재선점할 수 없으므로, 클라이언트가 그대로 재시도하게 409 로 올린다.
    if (!existing) throw this.inProgress();

    assertSameRequest(existing.requestHash, ref.requestHash);

    if (existing.completedAt === null) throw this.inProgress();

    return { status: existing.responseStatus ?? HttpStatus.OK, body: existing.responseBody };
  }

  /**
   * 도메인 쓰기가 끝난 **같은 트랜잭션**에서 응답을 봉인한다.
   *
   * 응답 본문은 JSON 으로 저장되므로 재생 시 Date 는 ISO 문자열이 된다.
   * HTTP 로 나갈 때도 어차피 문자열이라 클라이언트가 보는 모양은 같다.
   */
  async complete(tx: Tx, ref: IdempotencyKeyRef, status: number, body: unknown): Promise<void> {
    await tx.$executeRaw`
      UPDATE "IdempotencyRecord"
      SET "responseStatus" = ${status},
          "responseBody"   = ${JSON.stringify(body ?? null)}::jsonb,
          "completedAt"    = now()
      WHERE "userId" = ${ref.userId} AND "endpoint" = ${ref.endpoint} AND "key" = ${ref.key}
    `;
  }

  private inProgress(): ConflictException {
    // Retry-After 헤더는 컨트롤러 계층이 없어 본문에 실어 보낸다.
    // 화면은 이 값을 보고 "처리 중입니다" 를 유지한 채 재조회해야 한다 — 새 요청을 만들면 안 된다.
    return new ConflictException({
      code: 'IDEMPOTENT_REQUEST_IN_PROGRESS',
      retryAfterSeconds: RETRY_AFTER_SECONDS,
      message: '같은 요청이 처리 중입니다. 잠시 후 다시 조회해 주세요.',
    });
  }
}

function assertSameRequest(stored: string, incoming: string): void {
  if (stored === incoming) return;

  throw new HttpException(
    {
      code: 'IDEMPOTENCY_KEY_REUSED',
      message: '같은 Idempotency-Key 로 다른 내용의 요청이 들어왔습니다. 새 키로 다시 시도해 주세요.',
    },
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}

/** 키 순서를 정렬해 직렬화한다. undefined 는 키 자체를 지워 "없음"과 동일하게 취급한다. */
function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);

  return `{${entries.join(',')}}`;
}

/**
 * 유니크 위반인지 본다. `application_event_user_uq`(1인 1신청) 충돌을
 * 500 이 아니라 "이미 신청하셨습니다"로 갈라내기 위한 것이다.
 *
 * 코드를 둘 다 보는 이유: Prisma 클라이언트 API 로 쓴 INSERT 는 P2002 로 오지만,
 * `$executeRaw` 로 쓴 INSERT 는 P2010(raw query failed)에 Postgres 원본 코드 23505 가
 * meta 안에 들어온 채로 온다. 우리 신청 INSERT 는 raw 라서 P2002 만 보면 절대 안 걸린다.
 */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;

  const meta = JSON.stringify(error.meta ?? {});
  const isUnique =
    error.code === 'P2002' || (error.code === 'P2010' && meta.includes('23505'));

  if (!isUnique) return false;

  return constraint === undefined || meta.includes(constraint);
}
