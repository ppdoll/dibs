'use client';

import { useEffect, useId, useState } from 'react';

import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Textarea,
} from '@/components/ui';

import { Notice } from './console';

/**
 * 운영 조치 확인 창.
 *
 * 콘솔의 모든 조치가 같은 모양을 갖도록 하나로 묶었다. 규칙이 셋 있다.
 *
 * 1. **사유는 대부분 필수다.** 감사 로그의 `reasonMemo` 로 그대로 들어가고,
 *    반려·정지 같은 조치는 그 문구가 상대방에게 그대로 간다. 그래서 placeholder 에
 *    "상대가 읽는다"는 사실을 적어 둔다.
 * 2. **되돌릴 수 없는 조치는 파급을 문장으로 적는다.** "정말 취소할까요?" 로는
 *    무슨 일이 일어나는지 알 수 없다 — 몇 명에게 알림이 나가는지까지 써야 한다.
 * 3. **처리 중에는 바깥 클릭으로 닫히지 않는다.** 요청이 날아가는 동안 창이 사라지면
 *    성공했는지 알 방법이 없다.
 */
export function ActionDialog({
  open,
  onOpenChange,
  title,
  description,
  warning,
  confirmLabel,
  cancelLabel = '닫기',
  destructive,
  reason,
  children,
  pending,
  errorMessage,
  onConfirm,
  /** 사유 외의 입력이 유효한지. false 면 실행 버튼을 잠근다. */
  canConfirm = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  warning?: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  reason?: {
    label: string;
    required?: boolean;
    placeholder?: string;
    hint?: React.ReactNode;
    maxLength?: number;
  };
  children?: React.ReactNode;
  pending?: boolean;
  errorMessage?: string | null;
  onConfirm: (reason: string) => void;
  canConfirm?: boolean;
}) {
  const fieldId = useId();
  const [text, setText] = useState('');

  // 열 때마다 비운다. 안 그러면 직전 조치의 사유가 다음 대상에게 붙는다 —
  // 감사 로그에 남는 값이라 이런 오염은 나중에 되돌릴 수 없다.
  useEffect(() => {
    if (open) setText('');
  }, [open]);

  const reasonRequired = reason?.required ?? true;
  const reasonOk = !reason || !reasonRequired || text.trim().length > 0;
  const disabled = pending || !reasonOk || !canConfirm;

  return (
    <Dialog open={open} onOpenChange={pending ? () => undefined : onOpenChange}>
      <DialogContent dismissible={!pending} className="sm:max-w-lg">
        <DialogClose />

        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        <div className="space-y-3">
          {warning ? (
            <Notice tone={destructive ? 'danger' : 'warning'}>{warning}</Notice>
          ) : null}

          {children}

          {reason ? (
            <Field
              label={reason.label}
              htmlFor={fieldId}
              required={reasonRequired}
              {...(reason.hint ? { hint: reason.hint } : {})}
            >
              <Textarea
                id={fieldId}
                value={text}
                onChange={(event) => setText(event.currentTarget.value)}
                placeholder={reason.placeholder ?? '사유를 적어 주세요. 감사 로그에 그대로 남습니다.'}
                maxLength={reason.maxLength ?? 500}
                showCount
                className="min-h-[96px]"
              />
            </Field>
          ) : null}

          {errorMessage ? <Notice tone="danger">{errorMessage}</Notice> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'primary'}
            loading={pending}
            disabled={disabled}
            onClick={() => onConfirm(text.trim())}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 조치 버튼 하나 + 그에 딸린 확인 창.
 *
 * 표의 행마다 버튼을 놓을 때 상태(open)를 화면 컴포넌트가 전부 들고 있으면
 * `useState` 가 행 수만큼 늘어난다. 버튼과 창을 한 컴포넌트로 묶어 두면
 * 상태가 그 안에 갇힌다.
 */
export function ActionButton({
  label,
  variant = 'outline',
  size = 'sm',
  disabled,
  dialog,
  pending,
  errorMessage,
  onConfirm,
  children,
  canConfirm,
}: {
  label: string;
  variant?: React.ComponentProps<typeof Button>['variant'];
  size?: React.ComponentProps<typeof Button>['size'];
  disabled?: boolean;
  dialog: Omit<
    React.ComponentProps<typeof ActionDialog>,
    'open' | 'onOpenChange' | 'onConfirm' | 'pending' | 'errorMessage' | 'children' | 'canConfirm'
  >;
  pending?: boolean;
  errorMessage?: string | null;
  onConfirm: (reason: string, close: () => void) => void;
  children?: React.ReactNode;
  canConfirm?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant={variant}
        size={size}
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={size === 'sm' ? 'h-8 px-2.5 text-xs' : undefined}
      >
        {label}
      </Button>

      <ActionDialog
        {...dialog}
        open={open}
        onOpenChange={setOpen}
        pending={pending ?? false}
        errorMessage={errorMessage ?? null}
        {...(canConfirm === undefined ? {} : { canConfirm })}
        onConfirm={(reasonText) => onConfirm(reasonText, () => setOpen(false))}
      >
        {children}
      </ActionDialog>
    </>
  );
}
