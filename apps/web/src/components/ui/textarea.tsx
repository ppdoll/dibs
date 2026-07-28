import { forwardRef } from 'react';

import { cn } from '@/lib/utils';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string;
  /** 남은 글자 수를 오른쪽 아래에 보여준다. maxLength 와 함께 쓴다. */
  showCount?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, error, showCount, maxLength, value, id, ...props },
  ref,
) {
  const describedBy = error && id ? `${id}-error` : undefined;
  const length = typeof value === 'string' ? value.length : 0;

  return (
    <div className="w-full">
      <textarea
        ref={ref}
        id={id}
        value={value}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          'min-h-[120px] w-full resize-y rounded-lg border bg-background px-3 py-2.5',
          'text-base leading-relaxed outline-none placeholder:text-muted-foreground',
          'focus:ring-2 focus:ring-ring focus:ring-offset-1 focus:ring-offset-background',
          'disabled:cursor-not-allowed disabled:opacity-60',
          error ? 'border-destructive' : 'border-input',
          className,
        )}
        {...props}
      />
      <div className="mt-1.5 flex items-start justify-between gap-2">
        {error ? (
          <p id={describedBy} className="text-sm text-destructive">
            {error}
          </p>
        ) : (
          <span />
        )}
        {showCount && maxLength ? (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {length}/{maxLength}
          </span>
        ) : null}
      </div>
    </div>
  );
});
