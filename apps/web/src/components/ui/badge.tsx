import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * 상태 배지.
 *
 * 색만으로 뜻을 전하지 않는다 — 항상 글자가 함께 있어야 한다.
 * 색각 이상 사용자에게 "빨강 = 마감" 은 전달되지 않는다.
 */
export const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold leading-5 whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'bg-primary/10 text-primary',
        secondary: 'bg-secondary text-secondary-foreground',
        outline: 'border border-border text-foreground',
        muted: 'bg-muted text-muted-foreground',
        success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
        warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
        destructive: 'bg-destructive/10 text-destructive',
        /** 사진 위에 얹는 반투명 배지 */
        overlay: 'bg-black/60 text-white backdrop-blur-sm',
      },
      size: {
        sm: 'px-1.5 py-0 text-[11px]',
        md: '',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}

/** 숫자 배지(안 읽은 알림 수). 99를 넘으면 99+ 로 접는다. */
export function CountBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;

  return (
    <span
      className={cn(
        'inline-flex min-w-[18px] items-center justify-center rounded-full bg-primary px-1',
        'text-[11px] font-bold leading-[18px] text-primary-foreground tabular-nums',
        className,
      )}
      aria-label={`읽지 않음 ${count}건`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
