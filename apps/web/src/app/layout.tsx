import type { Metadata, Viewport } from 'next';

import { ServiceWorkerRegistrar } from '@/components/pwa/service-worker';
import { BRAND_COPY } from '@/lib/brand';
import { SITE_URL } from '@/lib/site';
import { AppProviders } from '@/providers/app-providers';
import './globals.css';

const TITLE = `${BRAND_COPY.wordmark} — ${BRAND_COPY.headline}`;

export const metadata: Metadata = {
  // OG 이미지 주소를 절대 경로로 만들기 위해 반드시 필요하다. 없으면 Next 가 경고만 남기고
  // 상대 경로를 내보내는데, 카카오톡·슬랙 크롤러는 그걸 해석하지 못해 미리보기가 빈다.
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: '%s | Dibs',
  },
  description: BRAND_COPY.sub,
  applicationName: 'Dibs',

  openGraph: {
    type: 'website',
    siteName: 'Dibs',
    locale: 'ko_KR',
    url: '/',
    title: TITLE,
    description: BRAND_COPY.sub,
    // images 는 적지 않는다 — app/opengraph-image.tsx 를 Next 가 알아서 붙인다.
    // 여기에 손으로 적으면 규약 파일과 둘 다 나가서 크롤러마다 다른 그림을 고른다.
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: BRAND_COPY.sub,
  },

  // 홈 화면에서 띄웠을 때 사파리 UI 없이 뜬다. 매니페스트의 standalone 과 짝이다
  // (iOS 는 매니페스트의 display 를 오래 무시했고, 지금도 이 메타를 함께 본다).
  appleWebApp: {
    capable: true,
    title: 'Dibs',
    statusBarStyle: 'default',
  },

  formatDetection: {
    // 사파리가 "10명", "2026-07-27" 같은 문자열을 전화번호·날짜 링크로
    // 바꿔버리면 파란 밑줄이 생기고 탭 영역까지 뺏긴다.
    telephone: false,
    date: false,
    address: false,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  // 상단 바가 배경색과 이어져 보이도록 라이트/다크를 나눠 준다.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0b' },
  ],
  viewportFit: 'cover', // 노치·홈 인디케이터 영역까지 그린 뒤 safe-area 로 피한다
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className="min-h-dvh">
        {/* 키보드 사용자를 위한 본문 바로가기. 탭 한 번에 내비를 건너뛴다. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
        >
          본문 바로가기
        </a>
        <AppProviders>
          <div id="main-content">{children}</div>
        </AppProviders>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
