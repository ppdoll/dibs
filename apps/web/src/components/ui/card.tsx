import { forwardRef } from 'react';

import { cn } from '@/lib/utils';

/**
 * 카드. catchtable 처럼 목록의 기본 단위다.
 *
 * `interactive` 를 켜면 눌리는 느낌(hover/active)이 붙는다. 카드 전체가
 * 링크인 경우에 쓴다 — 손가락으로 누를 영역이 클수록 좋다.
 */
export const Card = forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean }
>(function Card({ className, interactive, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-lg border bg-card text-card-foreground',
        interactive && 'transition-colors hover:border-foreground/20 active:bg-accent',
        className,
      )}
      {...props}
    />
  );
});

export const CardHeader = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardHeader({ className, ...props }, ref) {
    return <div ref={ref} className={cn('flex flex-col gap-1 p-4', className)} {...props} />;
  },
);

export const CardTitle = forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  function CardTitle({ className, ...props }, ref) {
    return (
      <h3
        ref={ref}
        className={cn('text-base font-semibold leading-snug tracking-tight', className)}
        {...props}
      />
    );
  },
);

export const CardDescription = forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(function CardDescription({ className, ...props }, ref) {
  return <p ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />;
});

export const CardContent = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardContent({ className, ...props }, ref) {
    return <div ref={ref} className={cn('p-4 pt-0', className)} {...props} />;
  },
);

export const CardFooter = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardFooter({ className, ...props }, ref) {
    return <div ref={ref} className={cn('flex items-center gap-2 p-4 pt-0', className)} {...props} />;
  },
);

/** 정보 한 줄("정원 · 10명"). 상세 화면의 요약표에 쓴다. */
export function CardRow({
  label,
  value,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 py-2 text-sm', className)}>
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
