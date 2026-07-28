'use client';

import { cn } from '@/lib/utils';

/**
 * 켜기/끄기 스위치.
 *
 * 네이티브 체크박스에 role 을 얹는 대신 `role="switch"` 버튼으로 만든다.
 * 알림 설정처럼 "누르는 즉시 저장" 되는 항목은 체크박스(폼 제출 전제)보다
 * 스위치가 맞고, 스크린리더도 "켜짐/꺼짐"으로 읽어 준다.
 */
export function ToggleSwitch({
  checked,
  onChange,
  label,
  description,
  disabled,
  note,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  /** 끌 수 없는 항목의 이유 같은 것 */
  note?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3.5">
      <div className="min-w-0">
        <p className={cn('text-sm font-medium', disabled && 'text-muted-foreground')}>{label}</p>
        {description ? (
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
        {note ? <p className="mt-0.5 text-xs text-muted-foreground">{note}</p> : null}
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition-colors',
          checked ? 'bg-primary' : 'bg-muted',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <span
          className={cn(
            'absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-6' : 'translate-x-1',
          )}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}
