'use client';

import { validateRaise } from '@dibs/shared';
import { TrendingUp } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  useToast,
} from '@/components/ui';
import { isApiError, toUserMessage } from '@/lib/api-client';
import { formatAmountRule, formatWon, parseWonInput } from '@/lib/format';
import type { MyApplicationDetail } from '@/types/api';

import { previewRaiseDeposit } from '../../../_lib/deposit';
import { useRaiseMutation } from '../../../_lib/queries';

/**
 * 금액 올리기. (D-06)
 *
 * 올리기만 된다. 서버가 WHERE 절로 막지만 **여기서도 먼저 막는다** —
 * 왕복 한 번을 기다린 뒤 "내릴 수 없습니다" 를 보는 것보다, 입력하는 순간
 * 아는 편이 훨씬 낫다. 검사는 @dibs/shared 의 validateRaise 를 그대로 쓴다.
 *
 * ★ D-07 — "얼마나 올려야 될까요" 에 답하지 않는다. 그 답은 남의 금액을
 *   알아야 나오고, 그게 곧 커트라인이다. 보여주는 건 내 현재 금액과 규칙뿐이다.
 */
export function RaiseDialog({
  open,
  onOpenChange,
  application,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  application: MyApplicationDetail;
}) {
  const toast = useToast();
  const raise = useRaiseMutation(application.id);

  const [raw, setRaw] = useState('');

  useEffect(() => {
    if (open) setRaw('');
  }, [open]);

  const min = application.event.minAmount;
  const max = application.event.maxAmount;
  const current = application.myAmount;

  const nextAmount = parseWonInput(raw);

  const localIssue = useMemo(() => {
    if (nextAmount === null) return null;
    const result = validateRaise({ min, max }, current, nextAmount);
    return result.ok ? null : (result.issues[0]?.message ?? '금액을 다시 확인해 주세요.');
  }, [nextAmount, min, max, current]);

  const serverIssue = isApiError(raise.error) ? raise.error.fieldMessage('amount') : undefined;

  // 예약금 차액 미리보기. 규칙을 역산한 값이라 "예상" 이라고 못 박는다.
  const preview =
    nextAmount !== null && !localIssue ? previewRaiseDeposit(application, nextAmount) : null;

  const canSubmit = nextAmount !== null && !localIssue && !raise.isPending;

  const onSubmit = () => {
    if (nextAmount === null) return;

    raise.mutate(nextAmount, {
      onSuccess: (result) => {
        onOpenChange(false);

        const shortfall = result.deposit.dueAt !== null;
        toast.toast({
          title: '금액을 올렸어요',
          description: shortfall
            ? `추가 예약금 결제 기한 안에 결제해야 ${formatWon(result.myAmount)} 이 유지돼요.`
            : `이제 ${formatWon(result.myAmount)} 으로 신청되어 있어요.`,
          variant: 'success',
        });
      },
      onError: (error) => {
        if (isApiError(error) && error.fieldMessage('amount')) return;
        toast.error('금액을 올리지 못했어요', toUserMessage(error));
      },
    });
  };

  const banner =
    isApiError(raise.error) && !raise.error.fieldMessage('amount') ? raise.error.message : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dismissible={!raise.isPending}>
        <DialogHeader>
          <DialogTitle>금액 올리기</DialogTitle>
          <DialogDescription>
            지금 신청한 금액은 <b>{formatWon(current)}</b> 이에요. 이보다 높은 금액만 넣을 수 있어요.
          </DialogDescription>
        </DialogHeader>

        <Field
          label="새 금액"
          htmlFor="raise-amount"
          required
          hint={`가능 범위 ${formatAmountRule(min, max)}`}
        >
          <Input
            id="raise-amount"
            inputMode="numeric"
            autoComplete="off"
            placeholder={String(Math.min(max, current + 10_000))}
            trailing="원"
            value={nextAmount === null ? raw : nextAmount.toLocaleString('ko-KR')}
            onChange={(e) => setRaw(e.target.value)}
            error={localIssue ?? serverIssue}
          />
        </Field>

        {preview && preview.estimated ? (
          <div className="mt-3 rounded-lg bg-muted/50 p-3.5 text-sm">
            <p className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">예상 추가 예약금</span>
              <span className="font-bold tabular-nums">{formatWon(preview.shortfall)}</span>
            </p>
            {preview.shortfall > 0 ? (
              <p className="mt-1.5 leading-relaxed text-muted-foreground">
                금액을 올리면 차액을 새 기한 안에 결제해야 해요. 결제하지 않으면 금액만 원래대로
                돌아가고 신청은 그대로 남아요.
              </p>
            ) : (
              <p className="mt-1.5 text-muted-foreground">추가로 낼 예약금은 없을 것 같아요.</p>
            )}
            <p className="mt-1.5 text-xs text-muted-foreground">
              정확한 금액은 올린 직후 안내드려요.
            </p>
          </div>
        ) : null}

        <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <TrendingUp className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          금액을 올리면 &quot;그 금액에 도달한 시각&quot;이 지금으로 새로 매겨져요. 같은 금액을 낸
          분들 사이에서는 먼저 그 금액에 도달한 분이 앞서요.
        </p>

        {banner ? (
          <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {banner}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={raise.isPending}>
            닫기
          </Button>
          <Button loading={raise.isPending} disabled={!canSubmit} onClick={onSubmit}>
            {nextAmount === null ? '금액 입력' : `${formatWon(nextAmount)} 으로 올리기`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
