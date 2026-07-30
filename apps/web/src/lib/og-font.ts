/**
 * OG 이미지용 한글 폰트 로더.
 *
 * ★ 왜 필요한가 — `next/og`(Satori)의 기본 폰트는 라틴 전용이다. 한글을 그대로 그리면
 *   전부 두부(□)로 나온다. 카카오톡·슬랙 미리보기에 네모만 늘어선 카드가 뜬다.
 *
 * ★ 왜 파일을 저장소에 넣지 않았나 — 한글 폰트는 전체가 수 MB 다. 서버리스 번들에
 *   그걸 얹느니 **필요한 글자만** 받아 온다. Google Fonts 의 `&text=` 파라미터가
 *   서브셋을 만들어 주므로 실제 전송량은 몇 KB 다.
 *
 * ★ woff2 를 못 쓴다 — Satori 는 ttf/otf/woff 만 읽는다. Google Fonts 는 요청 UA 를 보고
 *   포맷을 고르는데, 최신 UA 로 보이면 woff2 를 준다. 그래서 UA 를 붙이지 않고,
 *   응답에서 truetype/opentype 만 골라 쓴다.
 */

type LoadedFont = { name: string; data: ArrayBuffer; weight: 400 | 700; style: 'normal' };

const FAMILY = 'Noto Sans KR';

/**
 * Satori 가 읽을 수 있는 포맷의 URL 만 골라낸다.
 *
 * CSS 한 덩어리에 `src: url(...) format('woff2')` 가 여러 줄 들어오므로 전부 훑고
 * truetype → opentype → woff 순으로 고른다. woff2 밖에 없으면 포기한다(두부보다 낫다).
 */
function pickUsableFontUrl(css: string): string | null {
  const entries: Array<{ url: string; format: string }> = [];
  const re = /url\((https:\/\/[^)]+)\)\s*format\('([^']+)'\)/g;

  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const [, url, format] = m;
    // noUncheckedIndexedAccess 때문만이 아니라, 캡처가 비는 응답이 실제로 올 수 있다.
    if (url && format) entries.push({ url, format });
  }

  for (const wanted of ['truetype', 'opentype', 'woff']) {
    const hit = entries.find((e) => e.format === wanted);
    if (hit) return hit.url;
  }

  return null;
}

async function fetchSubset(text: string, weight: 400 | 700): Promise<LoadedFont | null> {
  const url =
    `https://fonts.googleapis.com/css2?family=${encodeURIComponent(FAMILY)}:wght@${weight}` +
    `&text=${encodeURIComponent(text)}`;

  try {
    // UA 를 일부러 붙이지 않는다 — 붙이면 woff2 가 온다.
    const css = await fetch(url, { cache: 'force-cache' }).then((r) => (r.ok ? r.text() : ''));
    const fontUrl = css ? pickUsableFontUrl(css) : null;
    if (!fontUrl) return null;

    const res = await fetch(fontUrl, { cache: 'force-cache' });
    if (!res.ok) return null;

    return { name: FAMILY, data: await res.arrayBuffer(), weight, style: 'normal' };
  } catch {
    // 네트워크가 막혀도 OG 라우트가 500 을 내면 안 된다. 라틴 폴백으로 넘어간다.
    return null;
  }
}

export interface BrandFonts {
  /** ImageResponse 의 `fonts` 에 그대로 넘긴다. 비어 있으면 기본 라틴 폰트가 쓰인다. */
  fonts: LoadedFont[];
  /** 한글을 그려도 되는가. false 면 호출부가 라틴 전용 문구로 바꿔야 한다. */
  korean: boolean;
  /** Satori `fontFamily` 에 넣을 값. */
  family: string;
}

/**
 * @param text 이미지에 실제로 그릴 모든 문자. 서브셋 요청에 쓰이므로
 *             **여기 빠진 글자는 렌더링 시 두부가 된다.**
 */
export async function loadBrandFonts(text: string): Promise<BrandFonts> {
  // 중복 글자를 지워 URL 을 짧게 만든다. Google 은 긴 text 파라미터를 거절한다.
  const unique = Array.from(new Set(text)).join('');

  const [bold, regular] = await Promise.all([fetchSubset(unique, 700), fetchSubset(unique, 400)]);
  const fonts = [bold, regular].filter((f): f is LoadedFont => f !== null);

  return {
    fonts,
    korean: fonts.length > 0,
    family: fonts.length > 0 ? FAMILY : 'sans-serif',
  };
}
