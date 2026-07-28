import { randomBytes } from 'node:crypto';

/**
 * 시설 슬러그 생성.
 *
 * `venue_slug_uq` 는 `WHERE "deletedAt" IS NULL` 부분 유니크다 — 소프트 삭제된 시설이
 * 슬러그를 영구 점유하지 않는 대신, **살아 있는 행끼리는 여전히 충돌한다**.
 * '강남점'이라는 이름은 전국에 수백 개이므로 이름만으로 만들면 두 번째 파트너가 막힌다.
 * 그래서 항상 짧은 무작위 꼬리를 붙인다 — 재시도 루프보다 충돌 자체를 없애는 쪽이 싸다.
 */
const MAX_SLUG_LENGTH = 80;
const SUFFIX_LENGTH = 6;

export function buildVenueSlug(name: string, explicit?: string): string {
  const base = slugify(explicit ?? name) || 'venue';
  const head = base.slice(0, MAX_SLUG_LENGTH - SUFFIX_LENGTH - 1);

  return `${head}-${randomSuffix()}`;
}

/**
 * 한글을 로마자로 바꾸지 않고 그대로 남긴다.
 * 음차 변환 규칙(국어의 로마자 표기법)은 예외가 많아 서버가 임의로 정하면
 * 파트너가 기대한 주소와 달라진다. 브라우저·Next.js 는 유니코드 경로를 그대로 처리한다.
 */
function slugify(value: string): string {
  return value
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function randomSuffix(): string {
  return randomBytes(4).toString('hex').slice(0, SUFFIX_LENGTH);
}
