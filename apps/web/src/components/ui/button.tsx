import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef } from 'react';

import { cn } from '@/lib/utils';
import { Spinner } from './spinner';

/**
 * 버튼.
 *
 * 모바일 우선이라 기본 높이가 44px(size="md")이다. 애플 휴먼 인터페이스가
 * 권하는 최소 터치 영역이고, 실제로 이보다 작으면 한 손으로 못 누른다.
 * 상세 화면 하단 고정 CTA 는 size="xl" + full 을 쓴다.
 *
 * asChild 를 두지 않은 이유: radix 의존 없이 만들기로 했다. 링크를 버튼처럼
 * 보이게 하려면 `<Link className={buttonVariants({ variant, size })}>` 를 쓴다.
 */
export const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg',
    'font-semibold transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    'disabled:pointer-events-none disabled:opacity-50',
    'active:scale-[0.99]',
  ].join(' '),
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-9 px-3 text-sm',
        md: 'h-11 px-4 text-sm',
        lg: 'h-12 px-5 text-base',
        /** 하단 고정 CTA 전용 */
        xl: 'h-14 px-6 text-base',
        icon: 'h-11 w-11',
      },
      full: {
        true: 'w-full',
        false: '',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
      full: false,
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** 처리 중. 스피너를 띄우고 중복 클릭을 막는다. */
  loading?: boolean;
  /** 글자 왼쪽 아이콘 */
  leadingIcon?: React.ReactNode;
  /** 글자 오른쪽 아이콘 */
  trailingIcon?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, full, loading, leadingIcon, trailingIcon, children, disabled, type, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      // form 안의 버튼이 기본으로 submit 인 탓에 의도치 않은 제출이 자주 난다.
      // 명시하지 않으면 button 으로 둔다.
      type={type ?? 'button'}
      className={cn(buttonVariants({ variant, size, full }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner size="sm" /> : leadingIcon}
      {children}
      {!loading && trailingIcon}
    </button>
  );
});

/** 아이콘만 있는 버튼. 스크린리더용 라벨을 강제한다. */
export const IconButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonProps, 'size' | 'children'> & { label: string; children: React.ReactNode }
>(function IconButton({ label, children, variant = 'ghost', className, ...props }, ref) {
  return (
    <Button
      ref={ref}
      size="icon"
      variant={variant}
      aria-label={label}
      className={cn('shrink-0', className)}
      {...props}
    >
      {children}
    </Button>
  );
});
