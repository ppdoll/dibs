'use client';

import { AlertTriangle, ChevronLeft } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { EVENT_STATUS_LABEL, VENUE_STATUS_LABEL, labelOf } from '@/lib/format';
import {
  BUSINESS_VERIFICATION_LABEL,
  BUSINESS_VERIFICATION_VARIANT,
  EVENT_STATUS_VARIANT,
  SELECTION_STATUS_LABEL,
  SELECTION_STATUS_VARIANT,
  VENUE_STATUS_VARIANT,
} from '../_lib/labels';
import type { BusinessVerificationStatus, SelectionStatus } from '@/types/api';

/**
 * 파트너 화면의 공통 조각들.
 *
 * 콘솔은 화면이 많고 서로 비슷하다. 제목줄·뒤로가기·오류 배너를 화면마다 다시 쓰면
 * 열 몇 개짜리 표에서 여백이 한 칸씩 어긋나기 시작한다. 여기 모아 두고 전부 재사용한다.
 */

export function PartnerPageHeader({
  title,
  description,
  back,
  actions,
  badge,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** 상위 화면으로 돌아가는 링크. 콘솔에는 브라우저 뒤로가기 말고 눈에 보이는 길이 필요하다. */
  back?: { href: string; label: string };
  actions?: React.ReactNode;
  badge?: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      {back ? (
        <Link
          href={back.href}
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          {back.label}
        </Link>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight md:text-2xl">{title}</h1>
            {badge}
          </div>
          {description ? (
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

/** 저장 실패처럼 화면 전체에 해당하는 오류. 필드별 문구는 각 입력 밑에 따로 붙는다. */
export function ErrorBanner({ message, className }: { message?: string | null; className?: string }) {
  if (!message) return null;

  return (
    <div
      role="alert"
      className={cn(
        'mb-4 flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-destructive/5 p-3.5',
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
      <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">{message}</p>
    </div>
  );
}

/** 왜 이렇게 만들었는지 짧게 알려주는 회색 상자. 설정 화면의 "이게 뭔가요" 자리. */
export function InfoNote({
  title,
  children,
  className,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-lg bg-muted/60 p-3.5 text-sm leading-relaxed', className)}>
      {title ? <p className="mb-1 font-semibold">{title}</p> : null}
      <div className="text-muted-foreground">{children}</div>
    </div>
  );
}

/** 숫자 하나짜리 대시보드 카드. */
export function StatCard({
  label,
  value,
  hint,
  href,
  tone = 'default',
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  href?: string;
  tone?: 'default' | 'warning' | 'success';
}) {
  const body = (
    <div
      className={cn(
        'rounded-lg border bg-card p-4 transition-colors',
        href && 'hover:border-foreground/20',
        tone === 'warning' && 'border-amber-500/40',
        tone === 'success' && 'border-emerald-500/40',
      )}
    >
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );

  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

// ─── 상태 배지 ────────────────────────────────────────────────────────

export function EventStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={EVENT_STATUS_VARIANT[status] ?? 'muted'}>
      {labelOf(EVENT_STATUS_LABEL, status)}
    </Badge>
  );
}

export function VenueStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={VENUE_STATUS_VARIANT[status] ?? 'muted'}>
      {labelOf(VENUE_STATUS_LABEL, status)}
    </Badge>
  );
}

export function BusinessStatusBadge({ status }: { status: BusinessVerificationStatus }) {
  return (
    <Badge variant={BUSINESS_VERIFICATION_VARIANT[status] ?? 'muted'}>
      {BUSINESS_VERIFICATION_LABEL[status] ?? status}
    </Badge>
  );
}

export function SelectionStatusBadge({ status }: { status: SelectionStatus }) {
  return (
    <Badge variant={SELECTION_STATUS_VARIANT[status] ?? 'muted'}>
      {SELECTION_STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

/**
 * 가로로 넓은 표를 감싼다.
 *
 * 표는 콘솔에서 유일하게 모바일 폭을 못 지키는 물건이다. 줄바꿈으로 우겨넣으면
 * 금액과 시각이 세로로 겹쳐 읽을 수가 없어서, 표만 따로 가로 스크롤시킨다.
 */
export function TableScroller({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full min-w-[720px] border-collapse text-sm">{children}</table>
    </div>
  );
}
