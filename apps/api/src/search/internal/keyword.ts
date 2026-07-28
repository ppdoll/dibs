/**
 * 검색어 정규화 · LIKE 패턴 escape.
 *
 * 검색어는 유일하게 유저가 SQL 술어에 값을 직접 밀어 넣는 통로다.
 * 값 자체는 $queryRaw 태그드 템플릿이 파라미터로 바인딩하므로 주입은 막히지만,
 * **패턴 메타문자는 파라미터화로 막히지 않는다** — `%` 하나만 쳐도 술어가 전체 매치로 바뀌어
 * trgm 인덱스가 무의미해지고 결과도 의미를 잃는다. 그래서 값 escape 를 따로 둔다.
 */

/** 한 검색어가 커버할 수 있는 최대 길이. DTO 에서 40자로 이미 잘리지만 raw 경로의 최후 방어선이다. */
const MAX_KEYWORD_LENGTH = 40;

/**
 * 공백 정리 후 빈 문자열이면 null.
 *
 * 빈 문자열을 그대로 흘리면 `ILIKE '%%'` 가 되어 "검색어 없음"과 결과는 같은데
 * 비용만 훨씬 비싼 쿼리가 된다. 호출부가 `if (keyword)` 하나로 두 경로를 가르도록
 * 여기서 null 로 눕힌다.
 */
export function normalizeKeyword(raw: string | undefined | null): string | null {
  if (typeof raw !== 'string') return null;

  const collapsed = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_KEYWORD_LENGTH);
  return collapsed.length === 0 ? null : collapsed;
}

/**
 * `%keyword%` 형태의 ILIKE 패턴을 만든다.
 *
 * `\`, `%`, `_` 를 백슬래시로 escape 한다. Postgres 의 LIKE 기본 escape 문자가 백슬래시이고
 * standard_conforming_strings 가 켜져 있어(기본값) 별도 ESCAPE 절이 필요 없다.
 */
export function toLikePattern(keyword: string): string {
  return `%${keyword.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}
