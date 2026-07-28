/**
 * 통합 테스트용 DB 접속 + 스킵 가드.
 *
 * ★ DB 가 없는 개발자에게는 **실패가 아니라 스킵**이어야 한다.
 *   `pnpm test` 가 로컬 Postgres 유무에 따라 빨갛게 되면, 아무도 그 빨간색을 신뢰하지 않게 되고
 *   결국 진짜 실패도 같이 무시된다. 그래서 여기서 한 번만 판정하고 `describeIntegration` 으로 내려준다.
 */
import { PrismaClient } from '@prisma/client';

const RAW_URL = process.env.DATABASE_URL?.trim();

/** DATABASE_URL 이 있으면 통합 테스트를 돈다. */
export const hasDatabase = typeof RAW_URL === 'string' && RAW_URL.length > 0;

/**
 * DB 가 없으면 `describe.skip`. 스위트 이름은 그대로 출력되므로 "무엇을 안 돌렸는지"가 남는다.
 */
export const describeIntegration: typeof describe = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  // 한 번만 찍힌다(모듈 캐시). 스킵 사유를 사람이 볼 수 있어야 한다.
  console.warn(
    '\n[통합 테스트 건너뜀] DATABASE_URL 이 없습니다.\n' +
      '  실제 Postgres 를 붙여야 돌아갑니다:\n' +
      '    DATABASE_URL="postgresql://..." DIRECT_URL="postgresql://..." \\\n' +
      '      npx jest -c jest.integration.config.js\n' +
      '  선행: prisma migrate deploy (스키마와 CHECK·트리거 제약을 함께 올립니다)\n' +
      '  (마이그레이션을 건너뛰면 CHECK 제약이 없는 DB 라 일부 단언이 의미를 잃습니다.)\n',
  );
}

/**
 * 커넥션 풀을 넉넉히 잡은 URL.
 *
 * Prisma 기본 풀은 `물리 CPU x 2 + 1` 이다. INSTANT 동시 신청 테스트는 트랜잭션 8개를
 * 동시에 여는데, 그 트랜잭션들은 Event 행 락 앞에서 **직렬화되면서 커넥션을 계속 쥐고 있다**.
 * 풀이 모자라면 테스트가 P2024(연결 대기 초과)로 죽고, 그건 "코드가 틀렸다"가 아니라
 * "테스트 환경이 좁다"는 뜻이라 진단이 어렵다. 그래서 여기서 명시적으로 올린다.
 */
function withGenerousPool(url: string): string {
  const questionMark = url.indexOf('?');
  const base = questionMark === -1 ? url : url.slice(0, questionMark);
  const params = new URLSearchParams(questionMark === -1 ? '' : url.slice(questionMark + 1));

  params.set('connection_limit', '20');
  params.set('pool_timeout', '30');

  return `${base}?${params.toString()}`;
}

let client: PrismaClient | null = null;

/**
 * 테스트 프로세스 전체가 공유하는 클라이언트.
 *
 * 파일마다 새로 만들지 않는 이유: maxWorkers=1 이라 프로세스가 하나이고,
 * 파일 수만큼 풀이 곱해지면 Postgres 의 max_connections 를 먼저 때린다.
 */
export function getPrisma(): PrismaClient {
  if (!hasDatabase || RAW_URL === undefined) {
    throw new Error('DATABASE_URL 이 없습니다. describeIntegration 으로 감싸지 않은 코드입니다.');
  }

  if (client === null) {
    client = new PrismaClient({
      log: ['error'],
      datasources: { db: { url: withGenerousPool(RAW_URL) } },
    });
  }

  return client;
}

export async function disconnectPrisma(): Promise<void> {
  if (client !== null) {
    await client.$disconnect();
    client = null;
  }
}
