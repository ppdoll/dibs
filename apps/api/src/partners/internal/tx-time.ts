import type { Prisma } from '@prisma/client';

/**
 * 트랜잭션 시각을 DB 에서 받아온다. (IC-04 의 전제 3)
 *
 * 서버리스 인스턴스들의 벽시계는 서로 어긋난다. `verificationSubmittedAt`,
 * `submittedForReviewAt` 은 운영자 심사 큐의 정렬 키다 — 인스턴스가 만든 시각을 넣으면
 * 먼저 낸 파트너가 뒤로 밀리는 일이 시계 오차만으로 생긴다.
 *
 * Postgres 의 `now()` 는 **트랜잭션 시작 시각**이라, 한 트랜잭션이 찍는 모든 스탬프가
 * 자동으로 같은 값으로 맞춰지는 이득도 있다(상태와 스탬프가 1마이크로초 어긋나는 일이 없다).
 */
export async function dbNow(tx: Prisma.TransactionClient): Promise<Date> {
  const rows = await tx.$queryRaw<{ now: Date }[]>`SELECT now() AS now`;
  const row = rows[0];

  if (!row) {
    // 여기까지 오면 커넥션이 죽은 것이다. 조용히 JS 시각으로 대체하면 위 이유가 무의미해진다.
    throw new Error('DB 시각을 읽지 못했습니다.');
  }

  return row.now;
}
