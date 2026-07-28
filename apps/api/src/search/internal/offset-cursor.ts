import { BadRequestException } from '@nestjs/common';

/**
 * 오프셋을 커서 모양으로 감싼다. **시설 검색 전용**이다.
 *
 * 왜 여기만 오프셋인가: 시설 검색의 기본 정렬은 pg_trgm 유사도순인데,
 * 유사도는 컬럼이 아니라 검색어에 따라 매번 계산되는 값이라 키셋(마지막 행의 값 이후)을 만들 수 없다.
 * 이벤트 검색은 정렬 키가 전부 실제 컬럼이라 Prisma 의 id 커서를 그대로 쓴다 — 그쪽을 따라할 수 없어서 갈렸다.
 *
 * 오프셋을 그대로 노출하지 않고 감싸는 이유는 두 가지다.
 * 1. 나중에 키셋으로 바꿔도 클라이언트 계약이 안 깨진다(커서는 불투명한 문자열이라는 약속).
 * 2. 유저가 `?cursor=999999` 로 깊은 오프셋 스캔을 유발하는 걸 상한으로 막는다.
 */

const PREFIX = 'off:';

/**
 * 검색으로 도달할 수 있는 최대 오프셋.
 *
 * OFFSET 은 건너뛴 행도 전부 읽으므로 깊어질수록 선형으로 느려진다.
 * 5,000번째 검색 결과를 넘겨보는 사용자는 없고, 그 요청은 사실상 전부 크롤러다.
 */
export const MAX_SEARCH_OFFSET = 5_000;

export function encodeOffsetCursor(offset: number): string {
  return Buffer.from(`${PREFIX}${offset}`, 'utf8').toString('base64url');
}

/**
 * 커서를 오프셋으로 되돌린다. 커서가 없으면 0.
 *
 * 커서는 서버가 발급한 값이므로 형식이 깨졌다는 건 클라이언트가 손댔다는 뜻이다.
 * 0으로 조용히 되돌리면 무한 스크롤이 첫 페이지를 반복해서 그리므로, 400으로 끊는다.
 */
export function decodeOffsetCursor(cursor: string | undefined): number {
  if (!cursor) return 0;

  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!decoded.startsWith(PREFIX)) {
    throw new BadRequestException('커서가 올바르지 않습니다.');
  }

  const offset = Number(decoded.slice(PREFIX.length));
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new BadRequestException('커서가 올바르지 않습니다.');
  }
  if (offset > MAX_SEARCH_OFFSET) {
    throw new BadRequestException(
      `검색 결과는 ${MAX_SEARCH_OFFSET}건까지만 넘겨볼 수 있습니다. 검색어나 필터를 좁혀 주세요.`,
    );
  }

  return offset;
}
