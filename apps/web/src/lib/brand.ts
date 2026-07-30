/**
 * 브랜드 자산의 단일 출처.
 *
 * 파비콘 · 앱 아이콘 · OG 이미지가 전부 여기서 나온다. 마크를 고칠 일이 생기면
 * 이 파일 하나만 고치면 된다 — 아이콘마다 좌표를 복사해 두면 반드시 하나가 뒤처진다.
 */

/** `--primary: 349 89% 55%` 를 hex 로 굳힌 값. Satori 는 hsl 변수를 모른다. */
export const BRAND_COLOR = '#F2264C';
export const BRAND_INK = '#09090B';
export const BRAND_MUTED = '#71717A';

/**
 * 마크: 북마크(찜) 실루엣.
 *
 * "먼저 찜하는 예약" 이라는 제품을 16px 탭 아이콘에서도 읽히게 하려면 글자보다 도형이 낫다.
 * 64×64 격자에서 가로 26 을 차지하도록 잡았다 — 16px 로 줄여도 흰 도형이 6px 이라 뭉개지지 않는다.
 * 아래쪽 V 홈이 "선택됨" 을 겸한다.
 */
export const MARK_PATH =
  'M19 17C19 14.2386 21.2386 12 24 12H40C42.7614 12 45 14.2386 45 17V49.6C45 51.6 42.8 52.7 41.2 51.6L32 45.2L22.8 51.6C21.2 52.7 19 51.6 19 49.6Z';

/** 정사각(모서리 안 깎음). iOS·안드로이드 런처처럼 OS 가 직접 마스크를 씌우는 곳에 쓴다. */
export const SQUARE = 0;
/**
 * 기본 모서리 반경. **viewBox 단위(0~64)** 이지 픽셀이 아니다 — 64 격자의 14 는 21.9% 로
 * iOS 스퀘어클과 비슷하다. 출력 크기가 얼마든 이 값은 그대로 둔다.
 */
export const SQUIRCLE = 14;

/**
 * 마크 SVG 문자열.
 *
 * @param size        출력 한 변 픽셀
 * @param radius64    배경 모서리 반경. ★ **64 격자 기준이다 — 출력 픽셀이 아니다.**
 *                    512px 아이콘이라고 112 를 넘기면 rx 가 반지름(32)을 넘어 **원**이 된다.
 *                    실제로 한 번 그렇게 냈다. 그래서 이름에 단위를 박고 32 로 자른다.
 * @param markScale   마크 배율. 안전영역을 더 좁게 잡아야 할 때만 건드린다.
 */
export function markSvg({
  size,
  radius64 = SQUIRCLE,
  markScale = 1,
}: {
  size: number;
  radius64?: number;
  markScale?: number;
}): string {
  // rx 가 한 변의 절반을 넘으면 SVG 사양상 절반으로 클램프된다 = 원. 조용히 원이 되느니
  // 여기서 막는다.
  const radius = Math.max(0, Math.min(32, radius64));
  // 축소는 중심을 기준으로 한다. 좌상단 기준으로 scale 하면 마크가 왼쪽 위로 쏠린다.
  const offset = (64 * (1 - markScale)) / 2;
  const transform = markScale === 1 ? '' : ` transform="translate(${offset} ${offset}) scale(${markScale})"`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">`,
    `<rect width="64" height="64" rx="${radius}" fill="${BRAND_COLOR}"/>`,
    `<path d="${MARK_PATH}" fill="#ffffff"${transform}/>`,
    `</svg>`,
  ].join('');
}

/**
 * Satori 에 넣을 data URI.
 *
 * Satori 의 인라인 `<svg>` 지원은 버전마다 편차가 있다. `<img src="data:...">` 로 주면
 * 래스터라이저가 통째로 처리하므로 렌더링이 안정적이다.
 */
export function markDataUri(opts: Parameters<typeof markSvg>[0]): string {
  return `data:image/svg+xml;base64,${Buffer.from(markSvg(opts)).toString('base64')}`;
}

/** OG·아이콘에 쓰는 문구. 폰트 서브셋 요청에도 그대로 쓰이므로 한 곳에 모아 둔다. */
export const BRAND_COPY = {
  wordmark: 'Dibs',
  headline: '먼저 찜하는 예약',
  sub: '가고 싶던 그곳, 열리는 순간 먼저 찜하세요.',
} as const;
