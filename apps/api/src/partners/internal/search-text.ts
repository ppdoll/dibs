/**
 * `Venue.searchText` 를 만든다.
 *
 * 이 컬럼은 `venue_search_text_trgm`(GIN + gin_trgm_ops)이 걸린 검색 캐시다.
 * 검색 모듈은 이 컬럼 하나만 LIKE 로 훑는다 — 이름·지역·주소를 각각 OR 로 묶으면
 * trgm 인덱스를 못 타고 매번 시설 전체를 읽는다. 그래서 **쓰는 쪽(여기)이** 미리 합쳐 둔다.
 *
 * 소문자로 눌러 두는 이유: 검색 쪽이 ILIKE 대신 LIKE 를 쓸 수 있게 하려는 것이다.
 */
const MAX_SEARCH_TEXT = 1000;

export function buildVenueSearchText(parts: (string | null | undefined)[]): string {
  const seen = new Set<string>();

  for (const part of parts) {
    const value = part?.trim().toLowerCase();
    if (value) seen.add(value);
  }

  return [...seen].join(' ').slice(0, MAX_SEARCH_TEXT);
}
