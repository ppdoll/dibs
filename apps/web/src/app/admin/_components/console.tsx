'use client';

import Link from 'next/link';
import { AlertTriangle, ArrowLeft, Check, Copy, Info, Search, X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { Badge, buttonVariants, Input, Select, Spinner } from '@/components/ui';
import { cn } from '@/lib/utils';
import { formatDateTime, formatTimeAgo } from '@/lib/format';

/**
 * 콘솔 화면의 뼈대 조각들.
 *
 * 이용자 화면(catchtable 풍의 큰 카드)과 반대로 여기는 **밀도**가 목적이다.
 * 한 화면에 많이 보이고, 키보드로 빠르게 움직이고, 조치 버튼이 항상 같은 자리에 있는 것.
 * 그래서 여백을 줄이는 대신 구분선과 정렬을 규칙적으로 유지한다.
 */

// ─── 페이지 머리 ──────────────────────────────────────────────────────

export function AdminPage({
  title,
  description,
  actions,
  back,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** 상세 화면의 목록 복귀 링크 */
  back?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      {back ? (
        <Link
          href={back.href}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {back.label}
        </Link>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight md:text-2xl">{title}</h1>
          {description ? (
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>

      {children}
    </div>
  );
}

/** 화면 안의 구획. 표·폼 하나를 담는다. */
export function Panel({
  title,
  description,
  actions,
  footer,
  className,
  bodyClassName,
  children,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn('rounded-lg border bg-card text-card-foreground', className)}>
      {title || actions ? (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div className="min-w-0">
            {title ? <h2 className="text-sm font-bold">{title}</h2> : null}
            {description ? (
              <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}

      <div className={cn(bodyClassName ?? 'p-4')}>{children}</div>

      {footer ? <footer className="border-t px-4 py-3">{footer}</footer> : null}
    </section>
  );
}

// ─── 필터 줄 ──────────────────────────────────────────────────────────

export function Toolbar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-end gap-2', className)}>{children}</div>
  );
}

/**
 * 라벨 붙은 작은 select. 콘솔의 필터는 개수가 적고 값이 명확해서
 * 커스텀 드롭다운보다 네이티브가 빠르다(키보드로 첫 글자 점프가 공짜다).
 */
export function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  /** 빈 값의 표시 문구. 넘기지 않으면 "전체" 항목을 만들지 않는다. */
  allLabel?: string;
  className?: string;
}) {
  const id = useId();
  const merged = allLabel ? [{ value: '', label: allLabel }, ...options] : options;

  return (
    <div className={cn('min-w-[9rem]', className)}>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <Select
        id={id}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        options={merged}
        className="h-9 text-sm"
      />
    </div>
  );
}

/**
 * 검색창. `/` 로 포커스, Enter 로 검색, Esc 로 비우기.
 *
 * 검색어를 입력할 때마다 요청하지 않는 이유: 운영자 검색은 대부분 "정확히 아는 값"을
 * 붙여넣는 동작이라 자동완성이 필요 없고, 매 글자 요청은 큐 목록 인덱스를 헛되이 때린다.
 */
export function SearchField({
  value,
  onSubmit,
  placeholder = '검색어',
  label = '검색',
  className,
}: {
  value: string;
  onSubmit: (value: string) => void;
  placeholder?: string;
  label?: string;
  className?: string;
}) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value);

  // 바깥에서 필터가 초기화되면(예: 탭 전환) 입력창도 따라가야 한다.
  useEffect(() => setDraft(value), [value]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;

      const active = document.activeElement;
      const typing =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement ||
        (active instanceof HTMLElement && active.isContentEditable);
      if (typing) return;

      event.preventDefault();
      ref.current?.focus();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className={cn('min-w-[14rem] flex-1', className)}>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted-foreground">
        {label} <span className="text-[10px]">(/ 키로 이동)</span>
      </label>
      <Input
        ref={ref}
        id={id}
        value={draft}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onSubmit(draft.trim());
          }
          if (event.key === 'Escape') {
            setDraft('');
            onSubmit('');
          }
        }}
        className="h-9"
        leading={<Search className="h-4 w-4" aria-hidden="true" />}
        trailing={
          draft ? (
            <button
              type="button"
              aria-label="검색어 지우기"
              onClick={() => {
                setDraft('');
                onSubmit('');
              }}
              className="rounded p-0.5 hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null
        }
      />
    </div>
  );
}

// ─── 상태 표시 ────────────────────────────────────────────────────────

/** 대시보드 타일. 숫자 하나와 그 숫자를 눌렀을 때 갈 곳. */
export function StatTile({
  label,
  value,
  hint,
  href,
  tone = 'default',
  loading,
}: {
  label: string;
  value: number | string;
  hint?: React.ReactNode;
  href?: string;
  /** danger 는 "지금 사람이 봐야 한다"는 뜻으로만 쓴다. 남발하면 아무 뜻도 없어진다. */
  tone?: 'default' | 'warning' | 'danger';
  loading?: boolean;
}) {
  const body = (
    <>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-1 text-2xl font-bold tabular-nums',
          tone === 'danger' && 'text-destructive',
          tone === 'warning' && 'text-amber-600 dark:text-amber-400',
        )}
      >
        {loading ? <span className="inline-block h-7 w-10 animate-pulse rounded bg-muted" /> : value}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </>
  );

  const className = cn(
    'block rounded-lg border bg-card p-4 text-left',
    tone === 'danger' && 'border-destructive/40 bg-destructive/5',
    tone === 'warning' && 'border-amber-500/40 bg-amber-500/5',
    href && 'transition-colors hover:border-foreground/25 hover:bg-accent',
  );

  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

/** 라벨 · 값 한 줄. 상세 화면의 정보표. */
export function KeyValue({
  label,
  children,
  full,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  /** 값이 길면 한 줄을 통째로 쓴다(주소·사유 등). */
  full?: boolean;
}) {
  return (
    <div className={cn('py-2', full && 'sm:col-span-2')}>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm">{children ?? '-'}</dd>
    </div>
  );
}

export function KeyValueGrid({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">{children}</dl>;
}

/** 값이 없을 때 "-" 로 그리되, 회색으로 눌러 둔다. */
export function Maybe({ value }: { value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === '') {
    return <span className="text-muted-foreground">-</span>;
  }
  return <>{value}</>;
}

/** 시각. 절대시각(KST)을 본문으로, 상대시각을 보조로 — 둘 다 필요하다. */
export function TimeCell({ value, relative = true }: { value: string | null | undefined; relative?: boolean }) {
  if (!value) return <span className="text-muted-foreground">-</span>;

  return (
    <span className="whitespace-nowrap tabular-nums" title={formatDateTime(value)}>
      {formatDateTime(value)}
      {relative ? (
        <span className="ml-1.5 text-xs text-muted-foreground">{formatTimeAgo(value)}</span>
      ) : null}
    </span>
  );
}

/** ID 처럼 길고 복사할 일이 잦은 값. */
export function CopyableId({ value, className }: { value: string | null; className?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(() => {
    if (!value) return;
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    });
  }, [value]);

  if (!value) return <span className="text-muted-foreground">-</span>;

  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{value}</code>
      <button
        type="button"
        onClick={copy}
        aria-label={`${value} 복사`}
        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
        ) : (
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
        )}
      </button>
    </span>
  );
}

// ─── 안내 배너 ────────────────────────────────────────────────────────

export function Notice({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: 'info' | 'warning' | 'danger';
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  const Icon = tone === 'info' ? Info : AlertTriangle;

  return (
    <div
      className={cn(
        'flex gap-2.5 rounded-lg border p-3 text-sm leading-relaxed',
        tone === 'info' && 'border-border bg-muted/50 text-muted-foreground',
        tone === 'warning' && 'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300',
        tone === 'danger' && 'border-destructive/40 bg-destructive/5 text-destructive',
        className,
      )}
      role={tone === 'danger' ? 'alert' : undefined}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn(title && 'mt-0.5')}>{children}</div> : null}
      </div>
    </div>
  );
}

/**
 * "이 화면의 조치는 전부 기록됩니다" 안내.
 *
 * 콘솔의 거의 모든 POST 가 감사 행을 남긴다. 그 사실을 화면에 적어 두는 것 자체가
 * 통제다 — 기록된다는 걸 알고 누르는 것과 모르고 누르는 것은 다른 행동이다.
 */
export function AuditNotice({ children }: { children?: React.ReactNode }) {
  return (
    <Notice tone="info">
      {children ?? '이 화면에서 실행한 모든 조치는 행위자·사유와 함께 감사 로그에 남습니다.'}
    </Notice>
  );
}

// ─── 조치 버튼 묶음 ───────────────────────────────────────────────────

export function ActionRow({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap items-center gap-2', className)}>{children}</div>;
}

/** 조치가 진행 중일 때 표 위에 얇게 걸리는 표시. 화면을 가리지 않는다. */
export function BusyLine({ busy, label = '처리 중' }: { busy: boolean; label?: string }) {
  if (!busy) return null;

  return (
    <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
      <Spinner size="sm" />
      {label}
    </p>
  );
}

// ─── 배지 헬퍼 ────────────────────────────────────────────────────────

export function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone?: React.ComponentProps<typeof Badge>['variant'];
}) {
  return <Badge variant={tone ?? 'muted'}>{label}</Badge>;
}

/** SLA 기한 배지. 지났으면 빨갛게, 임박(6시간)이면 노랗게. */
export function SlaBadge({ dueAt }: { dueAt: string | null }) {
  if (!dueAt) return <span className="text-muted-foreground">-</span>;

  const due = new Date(dueAt).getTime();
  if (Number.isNaN(due)) return <span className="text-muted-foreground">-</span>;

  const remainMs = due - Date.now();
  const overdue = remainMs <= 0;
  const soon = !overdue && remainMs < 6 * 60 * 60_000;

  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="tabular-nums" title={formatDateTime(dueAt)}>
        {formatDateTime(dueAt)}
      </span>
      {overdue ? (
        <Badge variant="destructive" size="sm">
          SLA 초과
        </Badge>
      ) : soon ? (
        <Badge variant="warning" size="sm">
          임박
        </Badge>
      ) : null}
    </span>
  );
}

// ─── 링크 버튼 ────────────────────────────────────────────────────────

/**
 * 표 안의 "상세" 링크.
 *
 * Button 을 쓰지 않고 `buttonVariants` 로 Link 를 칠한다 — button 안에 a 를 넣으면
 * 유효하지 않은 마크업이고, 스크린리더가 역할을 두 번 읽는다.
 */
export function DetailLink({ href, label = '상세' }: { href: string; label?: string }) {
  return (
    <Link
      href={href}
      className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-8 px-2.5 text-xs')}
    >
      {label}
    </Link>
  );
}
