import { forwardRef } from 'react';

import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** 필드 아래 빨간 문구. ApiError.fieldMessage(field) 를 그대로 넣으면 된다. */
  error?: string;
  /**
   * 입력창 왼쪽/오른쪽에 붙는 장식. 예: trailing="원"
   * `prefix` 라는 이름을 못 쓰는 이유: React 의 HTMLAttributes 에 이미
   * RDFa 용 `prefix?: string` 이 있어서 타입이 충돌한다.
   */
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
}

/**
 * 텍스트 입력.
 *
 * 모바일 사파리는 글꼴이 16px 미만이면 포커스 시 화면을 확대해 버린다.
 * 그래서 기본 크기가 text-base(16px) 다 — 작아 보여도 줄이지 말 것.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, error, leading, trailing, id, ...props },
  ref,
) {
  const describedBy = error && id ? `${id}-error` : undefined;

  return (
    <div className="w-full">
      <div
        className={cn(
          'flex h-12 w-full items-center gap-2 rounded-lg border bg-background px-3',
          'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1 focus-within:ring-offset-background',
          error ? 'border-destructive' : 'border-input',
          props.disabled && 'opacity-60',
          className,
        )}
      >
        {leading ? <span className="shrink-0 text-sm text-muted-foreground">{leading}</span> : null}
        <input
          ref={ref}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            'w-full bg-transparent text-base outline-none',
            'placeholder:text-muted-foreground disabled:cursor-not-allowed',
          )}
          {...props}
        />
        {trailing ? <span className="shrink-0 text-sm text-muted-foreground">{trailing}</span> : null}
      </div>
      {error ? (
        <p id={describedBy} className="mt-1.5 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
});
