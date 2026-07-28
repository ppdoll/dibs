import type { Metadata, Viewport } from 'next';

import { AppProviders } from '@/providers/app-providers';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Dibs — 먼저 찜하는 예약',
    template: '%s | Dibs',
  },
  description: '가고 싶던 그곳, 열리는 순간 먼저 찜하세요.',
  applicationName: 'Dibs',
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
      </body>
    </html>
  );
}
