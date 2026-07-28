import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';

/** 트랜잭션 클라이언트. 신청·입찰·예약금의 모든 쓰기는 하나의 트랜잭션 안에서 일어난다. */
export type Tx = Prisma.TransactionClient;

/**
 * 컨트롤러가 요청마다 실어 보내는 부수 정보. 본문이 아니라 헤더·전송 계층에서 온다.
 *
 * DTO 에 넣지 않는 이유: 전역 ValidationPipe 가 forbidNonWhitelisted 라 본문에 선언하면
 * 클라이언트가 IP 를 직접 실어 보낼 수 있게 되고, 그러면 `UserIdentityLink` 의 근거가 조작된다.
 */
export interface RequestContext {
  idempotencyKey: string;
  ip: string | undefined;
}

const MAX_IDEMPOTENCY_KEY_LENGTH = 64;

/**
 * 상태를 바꾸는 모든 엔드포인트는 `Idempotency-Key` 를 요구한다. (IC-03)
 *
 * 옵션으로 두지 않는 이유: 마감 직전 상향 요청이 네트워크에서 유실되면 클라이언트는 재시도한다.
 * 그때 첫 시도가 이미 커밋돼 있으면 재시도는 `WHERE version = $expected` 에서 밀려 409 를 받고,
 * 화면은 그걸 "실패"로 보여준다. 사용자가 그 화면을 보고 더 높은 금액으로 다시 넣으면
 * **돈이 나가는 실패**가 된다. 키를 안 보내는 클라이언트가 하나라도 생기면 그 경로가 열린다.
 */
export function requireIdempotencyKey(raw: string | undefined): string {
  const key = raw?.trim();

  if (!key || key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new BadRequestException({
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      message: `Idempotency-Key 헤더가 필요합니다(1~${MAX_IDEMPOTENCY_KEY_LENGTH}자).`,
    });
  }

  return key;
}

/**
 * 요청 IP 의 SHA-256 해시. 원본 IP 는 어디에도 저장하지 않는다. (IC-18)
 *
 * 해시만 남기는 이유는 두 가지다. 개인정보를 들고 있지 않으면서도
 * `UserIdentityLink`(동일인 추정)의 근거로 쓸 수 있어야 하고, 동시에 그 값이
 * 유출돼도 IP 로 되돌릴 수 없어야 한다 — 솔트 없이 해시하면 IPv4 는 43억 개라
 * 전수 대입으로 1초 만에 복원된다.
 *
 * 전용 `IP_HASH_SALT` 가 아직 env 스키마에 없어서 JWT_SECRET 을 대체 솔트로 쓴다.
 * 솔트를 바꾸면 과거 해시와 대조가 끊기므로, 나중에 전용 값을 도입할 때는
 * 새 컬럼을 쓰거나 이전 값을 유지해야 한다.
 */
export function hashIp(ip: string | undefined): string | null {
  if (!ip) return null;

  const salt = process.env.IP_HASH_SALT ?? process.env.JWT_SECRET ?? '';
  return createHash('sha256').update(`${ip}|${salt}`).digest('hex');
}

/**
 * 멱등 레코드의 `endpoint` 키. 대상 리소스 id 를 문자열에 포함한다.
 *
 * PK 가 (userId, endpoint, key) 라서, id 를 빼면 같은 사용자가 서로 다른 신청에
 * 같은 키를 재사용했을 때 두 번째 요청이 첫 번째의 응답으로 재생된다 —
 * "A 를 올렸는데 B 의 성공 응답을 받는" 조용한 오작동이다.
 */
export const IdempotencyEndpoint = {
  apply: () => 'POST /applications',
  raise: (id: string) => `POST /applications/${id}/raise`,
  cancel: (id: string) => `POST /applications/${id}/cancel`,
  reapply: (id: string) => `POST /applications/${id}/reapply`,
  confirmDeposit: (id: string) => `POST /applications/${id}/deposit/confirm`,
} as const;

/** 조건부 UPDATE 가 0행일 때 쓰는 표준 충돌. 클라이언트는 재조회 후 다시 판단해야 한다. */
export function stateChanged(code: string, message: string): ConflictException {
  return new ConflictException({ code, message });
}

/**
 * 신청·입찰 트랜잭션의 시간 예산.
 *
 * Prisma 대화형 트랜잭션의 기본값(maxWait 2초 / timeout 5초)으로는 부족하다.
 * 이 트랜잭션들은 왕복이 열 번 가까이 되고, 마감 직전에는 소프트 클로즈 자문 락 앞에서
 * 실제로 줄을 선다. 기본값이면 그 대기가 곧 "입찰이 5초 만에 500 으로 죽는" 것이 되는데,
 * 사용자에게는 마감 직전에 가장 나쁜 실패다. Vercel 함수 타임아웃보다는 짧게 잡아
 * 함수가 죽기 전에 트랜잭션이 먼저 정리되게 한다.
 */
export const APPLICATION_TX_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;
