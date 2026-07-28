import { cn } from '@/lib/utils';

/**
 * 로딩 자리표시자.
 *
 * 스피너 대신 이걸 쓰는 이유: 목록이 들어올 자리의 **모양**을 미리 보여주면
 * 데이터가 도착했을 때 화면이 튀지 않는다. 카드 높이를 실제와 비슷하게 잡는 게 핵심이다.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  );
}

/** 텍스트 몇 줄. 마지막 줄은 짧게 — 진짜 문단처럼 보인다. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton
          key={index}
          className={cn('h-4', index === lines - 1 ? 'w-2/3' : 'w-full')}
        />
      ))}
    </div>
  );
}

/** 이벤트 카드 한 장 분량. 목록 로딩에 그대로 반복해서 쓴다. */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-lg border bg-card', className)}>
      <Skeleton className="aspect-[4/3] w-full rounded-none" />
      <div className="space-y-2 p-4">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-5 w-4/5" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  );
}

/** 가로형 리스트 행. 내 신청·알림 목록용. */
export function SkeletonRow({ className }: { className?: string }) {
  return (
    <div className={cn('flex gap-3 rounded-lg border bg-card p-4', className)}>
      <Skeleton className="h-16 w-16 shrink-0 rounded-md" />
      <div className="flex-1 space-y-2 py-1">
        <Skeleton className="h-4 w-3/5" />
        <Skeleton className="h-3 w-2/5" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  );
}

export function SkeletonList({
  count = 4,
  variant = 'row',
  className,
}: {
  count?: number;
  variant?: 'row' | 'card';
  className?: string;
}) {
  const Item = variant === 'card' ? SkeletonCard : SkeletonRow;
  return (
    <div className={cn(variant === 'card' ? 'grid grid-cols-2 gap-3' : 'space-y-3', className)}>
      {Array.from({ length: count }).map((_, index) => (
        <Item key={index} />
      ))}
    </div>
  );
}
