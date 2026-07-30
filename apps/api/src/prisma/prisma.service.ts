import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * 서버리스에서 람다 인스턴스가 재사용될 때마다 새 PrismaClient가 생기면
 * 커넥션이 누수된다. globalThis에 하나만 두고 재사용한다.
 *
 * DATABASE_URL은 pooled(pgbouncer) 주소를, DIRECT_URL은 마이그레이션용
 * 직결 주소를 쓴다. schema.prisma의 datasource가 둘을 구분한다.
 */
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

/**
 * 풀러 주소에 Prisma 가 필요로 하는 파라미터를 채워 준다.
 *
 * ★ 왜 필요한가 — Neon 을 Vercel 마켓플레이스로 붙이면 통합이 `DATABASE_URL` 을
 *   자동으로 심는데, 그 값에는 `pgbouncer=true` 가 **없다.**
 *   Neon 풀러는 PgBouncer 를 transaction 모드로 돌린다. 이 모드는 커넥션을 문장 단위로
 *   갈아끼우므로 세션에 매달린 prepared statement 가 남의 커넥션에서 되살아난다.
 *   Prisma 는 기본적으로 prepared statement 를 캐시하므로, 동시 요청이 겹치는 순간
 *   `prepared statement "s0" already exists` 로 죽는다. 한가할 때는 멀쩡하고
 *   **트래픽이 몰릴 때만** 터지는, 가장 늦게 발견되는 종류의 고장이다.
 *
 * ★ 왜 환경변수를 고치지 않고 코드에서 하는가 — 그 변수의 주인이 Neon 통합이다.
 *   손으로 덮어써도 리소스를 갱신하거나 자격증명을 회전시키면 통합이 원래 값으로
 *   되돌려 놓는다. 그때 조용히 깨지느니 부팅할 때마다 맞춰 넣는 편이 낫다.
 *
 * 로컬(localhost)처럼 `-pooler` 가 없는 주소는 손대지 않는다.
 */
export function normalizePooledUrl(raw: string | undefined): string | undefined {
  if (!raw) return raw;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // 파싱이 안 되는 주소는 그대로 넘긴다 — 여기서 판단할 문제가 아니다.
    return raw;
  }

  // 풀러를 거치는 주소만 대상이다. Neon 은 호스트에 `-pooler` 를 붙인다.
  if (!url.hostname.includes('-pooler')) {
    return raw;
  }

  // 이미 명시돼 있으면 존중한다. 운영자가 일부러 끈 것일 수 있다.
  if (!url.searchParams.has('pgbouncer')) {
    url.searchParams.set('pgbouncer', 'true');
  }

  // 서버리스는 요청마다 인스턴스가 뜬다. 인스턴스당 1개로 묶지 않으면
  // 풀러 뒤의 커넥션 수가 람다 수만큼 곱해진다.
  if (!url.searchParams.has('connection_limit')) {
    url.searchParams.set('connection_limit', '1');
  }

  return url.toString();
}

function createClient(): PrismaClient {
  const url = normalizePooledUrl(process.env.DATABASE_URL);

  if (url !== undefined && url !== process.env.DATABASE_URL) {
    // 무엇을 고쳤는지 남긴다. 비밀번호는 절대 찍지 않는다.
    new Logger(PrismaService.name).log(
      `풀러 주소에 pgbouncer·connection_limit 을 채웠습니다 (host=${new URL(url).hostname})`,
    );
  }

  return new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['error', 'warn'],
    ...(url === undefined ? {} : { datasources: { db: { url } } }),
  });
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    super();
    if (!globalForPrisma.prisma) {
      globalForPrisma.prisma = createClient();
    }
    return globalForPrisma.prisma as PrismaService;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }
}
