import { forwardRef } from 'react';

import { cn } from '@/lib/utils';

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  /** 필수 항목 표시. 별표 하나로 끝내지 말고 스크린리더에도 알려 준다. */
  required?: boolean;
}

export const Label = forwardRef<HTMLLabelElement, LabelProps>(function Label(
  { className, required, children, ...props },
  ref,
) {
  return (
    <label
      ref={ref}
      className={cn('mb-1.5 block text-sm font-medium text-foreground', className)}
      {...props}
    >
      {children}
      {required ? (
        <span className="ml-0.5 text-primary" aria-hidden="true">
          *
        </span>
      ) : null}
      {required ? <span className="sr-only"> (필수)</span> : null}
    </label>
  );
});

/** 라벨 아래 회색 보조 설명. */
export function FieldHint({ className, children }: { className?: string; children: React.ReactNode }) {
  return <p className={cn('mt-1.5 text-sm text-muted-foreground', className)}>{children}</p>;
}

/** 라벨 + 입력 + 설명을 묶는 최소 단위. 폼 간격을 한 곳에서 관리한다. */
export function Field({
  label,
  htmlFor,
  required,
  hint,
  children,
  className,
}: {
  label?: React.ReactNode;
  htmlFor?: string;
  required?: boolean;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('w-full', className)}>
      {label ? (
        <Label htmlFor={htmlFor} required={required}>
          {label}
        </Label>
      ) : null}
      {children}
      {hint ? <FieldHint>{hint}</FieldHint> : null}
    </div>
  );
}
