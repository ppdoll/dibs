import type { MetadataRoute } from 'next';

import { BRAND_COPY } from '@/lib/brand';

/**
 * PWA 매니페스트. Next 가 `/manifest.webmanifest` 로 내보내고 `<link rel="manifest">` 도 자동으로 넣는다.
 *
 * `theme_color` 를 브랜드 핑크가 아니라 흰색으로 둔 이유: 이 값은 안드로이드 standalone 모드의
 * **상단 상태바 색**이 된다. 앱 배경이 흰색인데 상태바만 핑크면 잘린 띠처럼 보인다.
 * 브라우저 탭의 테마색은 layout.tsx 의 `viewport.themeColor` 가 라이트/다크로 나눠 처리한다.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    // 설치된 앱의 고유 식별자. 없으면 브라우저가 start_url 로 대신 잡는데, 나중에
    // start_url 을 바꾸면 **다른 앱으로 인식돼** 사용자 홈 화면에 아이콘이 하나 더 생긴다.
    id: '/',

    name: `${BRAND_COPY.wordmark} — ${BRAND_COPY.headline}`,
    short_name: BRAND_COPY.wordmark,
    description: BRAND_COPY.sub,
    lang: 'ko',
    dir: 'ltr',

    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',

    background_color: '#ffffff',
    theme_color: '#ffffff',

    categories: ['food', 'lifestyle', 'travel'],

    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // 안드로이드 런처가 직접 잘라 쓰는 판본. 없으면 흰 원 안에 축소돼 들어간다.
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
