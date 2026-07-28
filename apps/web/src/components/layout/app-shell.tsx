'use client';

import { cn } from '@/lib/utils';
import { BottomTabBar, BottomTabSpacer } from './bottom-tab-bar';

/**
 * 이용자 화면의 껍데기.
 *
 *   <AppShell header={<TopBar showBack title="상세" />} bottom={<StickyBottomBar>…</StickyBottomBar>}>
 *
 * 하단 CTA(bottom)가 있으면 탭바를 감춘다. 두 개를 동시에 쌓으면 화면
 * 아래 100px 가 버튼으로 채워져서 내용을 볼 수가 없다. 상세 화면에서는
 * "신청하기" 가 탭 이동보다 중요하다.
 */
export function AppShell({
  header,
  bottom,
  children,
  className,
  /** 좌우 여백 없이 꽉 채운 레이아웃(사진 헤더 등) */
  bleed = false,
  showTabBar = true,
}: {
  header?: React.ReactNode;
  bottom?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bleed?: boolean;
  showTabBar?: boolean;
}) {
  const withTabBar = showTabBar && !bottom;

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      {header}

      <main className={cn('mx-auto w-full max-w-3xl flex-1', bleed ? '' : 'px-4', className)}>
        {children}
      </main>

      {/* 하단 고정 요소에 내용이 가리지 않도록 그만큼의 공간을 비운다. */}
      {withTabBar ? <BottomTabSpacer /> : null}
      {bottom ? <div className="h-20" aria-hidden="true" /> : null}

      {withTabBar ? <BottomTabBar /> : null}
      {bottom}
    </div>
  );
}

/**
 * 화면 하단에 붙는 CTA 영역. catchtable 상세의 "예약하기" 자리다.
 *
 * safe-area 를 더하는 이유: 홈 인디케이터가 있는 아이폰에서 버튼이
 * 그 선에 걸리면 누를 때마다 홈으로 나가버린다.
 */
export function StickyBottomBar({
  children,
  className,
  /** 버튼 위에 붙는 보조 정보(남은 시간, 금액 등) */
  info,
}: {
  children: React.ReactNode;
  className?: string;
  info?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur',
        className,
      )}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto w-full max-w-3xl px-4 py-3">
        {info ? <div className="mb-2">{info}</div> : null}
        <div className="flex items-center gap-2">{children}</div>
      </div>
    </div>
  );
}

/** 화면 제목 + 설명. 목록 상단에 쓴다. */
export function PageHeader({
  title,
  description,
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 py-5', className)}>
      <div className="min-w-0">
        <h2 className="text-xl font-bold tracking-tight">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** 섹션 제목 + 더보기. 홈 피드의 각 줄에 쓴다. */
export function SectionHeader({
  title,
  more,
  className,
}: {
  title: React.ReactNode;
  more?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center justify-between gap-3 py-3', className)}>
      <h3 className="text-lg font-bold tracking-tight">{title}</h3>
      {more ? <div className="shrink-0 text-sm text-muted-foreground">{more}</div> : null}
    </div>
  );
}
