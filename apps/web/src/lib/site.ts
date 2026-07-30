/**
 * 사이트의 절대 주소.
 *
 * ★ 왜 필요한가 — OG 이미지 URL 은 **절대 주소여야 한다.** 카카오톡·슬랙 크롤러는
 *   우리 페이지를 렌더링하지 않고 HTML 만 긁어가므로 `/opengraph-image` 같은 상대 경로를
 *   해석할 기준이 없다. Next 는 `metadataBase` 가 없으면 경고만 남기고 상대 경로를 내보내서
 *   **미리보기가 조용히 깨진다.**
 *
 * 우선순위:
 *   1. `NEXT_PUBLIC_SITE_URL` — 커스텀 도메인을 붙였을 때 여기에 적는다.
 *   2. `VERCEL_PROJECT_PRODUCTION_URL` — Vercel 이 넣어 주는 **운영** 도메인.
 *      프리뷰 배포에서도 운영 주소를 가리킨다. OG 는 그게 맞다 — 미리보기 카드가
 *      임시 프리뷰 URL 을 가리키면 그 배포가 사라진 뒤 이미지가 깨진다.
 *   3. 로컬 개발.
 *
 * 2번은 `NEXT_PUBLIC_` 접두사가 없다. 메타데이터는 서버에서만 계산되므로 문제없다 —
 * 클라이언트 컴포넌트에서 이 값을 읽으려 하면 undefined 가 된다.
 */
function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/+$/, '')}`;

  return 'http://localhost:3000';
}

export const SITE_URL = resolveSiteUrl();
