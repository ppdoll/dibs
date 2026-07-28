import { ChevronDown } from 'lucide-react';
import { forwardRef } from 'react';

import { cn } from '@/lib/utils';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options?: SelectOption[];
  placeholder?: string;
  error?: string;
}

/**
 * 네이티브 select 를 감싼 것.
 *
 * 커스텀 드롭다운을 만들지 않은 이유: 모바일에서는 OS 가 띄우는 휠 선택기가
 * 손가락으로 훨씬 정확하고, 스크린리더·키보드 지원도 공짜로 따라온다.
 * 화살표만 우리 것으로 바꿔 붙인다.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, options, placeholder, error, children, id, ...props },
  ref,
) {
  const describedBy = error && id ? `${id}-error` : undefined;

  return (
    <div className="w-full">
      <div className="relative">
        <select
          ref={ref}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            'h-12 w-full appearance-none rounded-lg border bg-background px-3 pr-10',
            'text-base outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 focus:ring-offset-background',
            'disabled:cursor-not-allowed disabled:opacity-60',
            error ? 'border-destructive' : 'border-input',
            className,
          )}
          {...props}
        >
          {placeholder ? (
            <option value="" disabled={props.required}>
              {placeholder}
            </option>
          ) : null}
          {options?.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
      </div>
      {error ? (
        <p id={describedBy} className="mt-1.5 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
});
