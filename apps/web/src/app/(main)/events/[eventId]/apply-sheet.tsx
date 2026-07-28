'use client';

import { AMOUNT_MAX, isFixedAmount, validateBidAmount } from '@dibs/shared';
import { Info, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import {
  Button,
  Field,
  Input,
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  useToast,
} from '@/components/ui';
import { isApiError, toUserMessage } from '@/lib/api-client';
import { formatAmountRule, formatWon, formatWonCompact, parseWonInput } from '@/lib/format';
import { useAuth } from '@/providers/auth-provider';
import type { PublicEventSummary } from '@/types/api';

import { useApplyMutation } from '../../_lib/queries';

/**
 * 신청 시트.
 *
 * 별도 페이지가 아니라 시트인 이유: 신청은 상세 화면에서 본 조건(마감·경쟁률·금액)을
 * 그대로 들고 결정하는 행동이다. 페이지를 갈아치우면 그 맥락을 다시 확인하러
 * 뒤로 갔다 와야 한다.
 *
 * ★ D-07 — 여기에는 "얼마를 써야 될까요" 에 답하는 어떤 힌트도 없다.
 *   추천 금액·평균 금액·커트라인은 전부 남의 금액에서 나오는 값이다.
 *   보여줄 수 있는 것은 이벤트가 정한 **범위**와 내 경쟁률뿐이다.
 */

/**
 * 동의한 약관의 버전. 서버는 이 문자열을 신청에 그대로 박아 둔다.
 * 약관 문서를 고칠 때 이 값도 같이 올려야 "그때 무엇에 동의했는가"를 되짚을 수 있다.
 */
export const RESERVATION_TERMS_VERSION = 'v1';

export function ApplySheet({
  open,
  onOpenChange,
  event,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: PublicEventSummary;
}) {
  const router = useRouter();
  const toast = useToast();
  const { isAuthenticated, login } = useAuth();

  const rule = { min: event.minAmount, max: event.maxAmount };
  const fixed = isFixedAmount(rule);

  const [rawAmount, setRawAmount] = useState('');
  const [agreed, setAgreed] = useState(false);

  // 시트를 열 때마다 처음 상태로. 이전 입력이 남아 있으면 "내가 얼마를 적었더라" 로 시작한다.
  useEffect(() => {
    if (!open) return;
    setRawAmount(fixed ? String(rule.min) : '');
    setAgreed(false);
  }, [open, fixed, rule.min]);

  const apply = useApplyMutation();

  const amount = fixed ? rule.min : parseWonInput(rawAmount);

  /**
   * 클라이언트에서도 같은 규칙으로 먼저 검사한다. 서버가 최종 판정을 하지만,
   * 왕복 한 번을 기다린 뒤 "범위를 벗어났습니다" 를 보는 것보다 즉시 아는 편이 낫다.
   * 검사 함수는 @dibs/shared 의 것을 그대로 쓴다 — 프론트에서 규칙을 다시 쓰면 언젠가 갈라진다.
   */
  const localIssue = useMemo(() => {
    if (amount === null) return null;
    const result = validateBidAmount(rule, amount);
    return result.ok ? null : (result.issues[0]?.message ?? '금액을 다시 확인해 주세요.');
    // rule 은 매 렌더 새 객체라 값으로 의존한다.
  }, [amount, rule.min, rule.max]); // eslint-disable-line react-hooks/exhaustive-deps

  const serverIssue = isApiError(apply.error) ? apply.error.fieldMessage('amount') : undefined;
  const amountError = localIssue ?? serverIssue;

  const canSubmit = amount !== null && !localIssue && agreed && !apply.isPending;

  const onSubmit = () => {
    if (!isAuthenticated) {
      login();
      return;
    }
    if (amount === null) return;

    apply.mutate(
      {
        eventId: event.id,
        // INSTANT 는 서버가 고정 금액을 쓴다. 그래도 보내지 않는 편이 명확하다.
        ...(fixed ? {} : { amount }),
        agreedTermsVersion: RESERVATION_TERMS_VERSION,
      },
      {
        onSuccess: (result) => {
          onOpenChange(false);

          const needsDeposit = result.deposit.dueAt !== null && result.deposit.requiredAmount > 0;

          toast.toast({
            title: needsDeposit ? '신청이 접수되었어요' : '신청이 완료되었어요',
            description: needsDeposit
              ? `${formatWon(result.deposit.requiredAmount)} 예약금을 기한 안에 결제하면 확정돼요.`
              : event.mode === 'INSTANT'
                ? '자리가 확정되었어요.'
                : '마감 후 당첨자 발표를 기다려 주세요.',
            variant: 'success',
          });

          // 예약금이 걸려 있으면 곧장 타이머가 있는 상세로 보낸다. 목록에서 다시 찾게 하면 늦는다.
          router.push(`/my/applications/${encodeURIComponent(result.id)}`);
        },
        onError: (error) => {
          // 필드 오류는 입력창 아래에 이미 붙는다. 여기서는 전체 오류만 알린다.
          if (isApiError(error) && error.fieldMessage('amount')) return;
          toast.error('신청하지 못했어요', toUserMessage(error));
        },
      },
    );
  };

  const bannerMessage =
    isApiError(apply.error) && !apply.error.fieldMessage('amount') ? apply.error.message : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" dismissible={!apply.isPending}>
        <SheetHeader>
          <SheetTitle>
            {event.mode === 'INSTANT' ? '선착순 즉시확정 신청' : '금액 제안하기'}
          </SheetTitle>
        </SheetHeader>
        {apply.isPending ? null : <SheetClose />}

        <SheetBody className="space-y-5">
          <p className="line-clamp-2 text-sm font-semibold">{event.title}</p>

          {fixed ? (
            <div className="rounded-lg border bg-muted/40 p-4">
              <p className="text-sm text-muted-foreground">신청 금액</p>
              <p className="mt-0.5 text-2xl font-extrabold tabular-nums">{formatWon(rule.min)}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                금액이 정해진 예약이에요. 신청하면 바로 확정돼요.
              </p>
            </div>
          ) : (
            <div>
              <Field
                label="제안할 금액"
                htmlFor="apply-amount"
                required
                hint={`${formatAmountRule(rule.min, rule.max)} 사이에서 원하는 금액을 적어 주세요.`}
              >
                <Input
                  id="apply-amount"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder={String(rule.min)}
                  trailing="원"
                  value={amount === null ? rawAmount : amount.toLocaleString('ko-KR')}
                  onChange={(e) => setRawAmount(e.target.value)}
                  error={amountError}
                />
              </Field>

              {/* 빠른 입력. 남의 금액을 참고한 값이 아니라 이벤트 범위에서만 만든 값이다. */}
              <div className="mt-2 flex flex-wrap gap-2">
                {quickAmounts(rule.min, rule.max).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setRawAmount(String(value))}
                    className="rounded-full border px-3 py-1.5 text-sm font-medium"
                  >
                    {formatWonCompact(value)}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2 rounded-lg bg-muted/40 p-4 text-sm leading-relaxed">
            <p className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span>
                예약금이 필요한 예약이라면, <b>신청 후 안내된 시간(보통 10분) 안에</b> 결제해야
                신청이 확정돼요. 결제하지 않으면 자동으로 취소돼요.
              </span>
            </p>
            <p className="flex items-start gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span>
                {event.mode === 'INSTANT'
                  ? '정원이 차면 더 이상 신청할 수 없어요.'
                  : '마감 후 당첨자 발표가 있어요. 발표 전까지 금액을 올릴 수 있고, 내릴 수는 없어요.'}
              </span>
            </p>
          </div>

          {bannerMessage ? (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {bannerMessage}
            </p>
          ) : null}

          <label className="flex cursor-pointer items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-[hsl(var(--primary))]"
            />
            <span>
              이용약관과 예약·환불 정책에 동의해요. <span className="text-primary">(필수)</span>
            </span>
          </label>
        </SheetBody>

        <SheetFooter>
          <Button
            full
            size="lg"
            loading={apply.isPending}
            disabled={!canSubmit}
            onClick={onSubmit}
          >
            {!isAuthenticated
              ? '로그인하고 신청하기'
              : amount === null
                ? '금액을 입력해 주세요'
                : `${formatWon(amount)} 신청하기`}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/**
 * 범위 안에서 만든 빠른 선택지. 최소 / 25% / 50% / 최대 지점.
 * "얼마가 유리한가" 를 암시하지 않도록 균등하게 나눈 값만 쓴다.
 */
function quickAmounts(min: number, max: number): number[] {
  if (max <= min) return [min];

  const span = max - min;
  const rawSteps = [min, min + Math.round(span * 0.25), min + Math.round(span * 0.5), max];

  // 만원 단위로 반올림해 읽기 쉽게. 범위를 벗어나지 않도록 다시 자른다.
  const rounded = rawSteps.map((value) => {
    const snapped = value >= 10_000 ? Math.round(value / 10_000) * 10_000 : value;
    return Math.min(Math.max(snapped, min), Math.min(max, AMOUNT_MAX));
  });

  return Array.from(new Set(rounded)).sort((a, b) => a - b);
}
