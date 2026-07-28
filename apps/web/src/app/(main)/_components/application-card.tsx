'use client';

import { AlertCircle, ChevronRight, Clock } from 'lucide-react';
import Link from 'next/link';

import { Badge, Button, CompetitionRatioBadge, DepositCountdown, useToast } from '@/components/ui';
import {
  APPLICATION_STATUS_LABEL,
  EVENT_MODE_LABEL,
  formatDateTimeKo,
  formatWon,
  labelOf,
} from '@/lib/format';
import { toUserMessage } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import type { ApplicationStatus, MyApplication } from '@/types/api';

import { useConfirmDepositMutation } from '../_lib/queries';

/**
 * 내 신청 카드.
 *
 * ★ D-07 — 여기 있는 금액은 **내가 적어낸 금액** 하나뿐이다. 내 순위도 없다.
 *   "몇 등입니다" / "얼마에 밀렸습니다" 류의 문구는 커트라인을 알려주는 것과 같다.
 *   보여줄 수 있는 경쟁 정보는 이벤트의 경쟁률뿐이다.
 */

const STATUS_VARIANT: Record<ApplicationStatus, 'default' | 'success' | 'warning' | 'muted' | 'destructive'> = {
  PENDING_DEPOSIT: 'warning',
  VALID: 'default',
  CONFIRMED: 'success',
  NOT_SELECTED: 'muted',
  EXPIRED: 'muted',
  CANCELED: 'muted',
  REJECTED: 'destructive',
  EVENT_CANCELED: 'destructive',
};

export function ApplicationStatusBadge({ status }: { status: ApplicationStatus }) {
  return (
    <Badge variant={STATUS_VARIANT[status] ?? 'muted'}>
      {labelOf(APPLICATION_STATUS_LABEL, status)}
    </Badge>
  );
}

/** 상태별 한 줄 설명. 사용자가 "그래서 지금 뭘 해야 하나"를 바로 알게 한다. */
export function statusHint(application: MyApplication): string {
  const isBid = application.event.mode === 'BID';

  switch (application.status) {
    case 'PENDING_DEPOSIT':
      return '예약금을 결제해야 신청이 확정돼요.';
    case 'VALID':
      return isBid ? '마감 후 당첨자 발표를 기다리는 중이에요.' : '신청이 접수되었어요.';
    case 'CONFIRMED':
      return '당첨되었어요. 이용일에 맞춰 방문해 주세요.';
    case 'NOT_SELECTED':
      return '이번에는 아쉽게 되지 않았어요. 예약금은 환불돼요.';
    case 'EXPIRED':
      return '예약금 입금 시간이 지나 신청이 만료되었어요.';
    case 'CANCELED':
      return '직접 취소한 신청이에요.';
    case 'REJECTED':
      return '신청이 처리되지 않았어요.';
    case 'EVENT_CANCELED':
      return '주최 측 사정으로 예약이 취소되었어요.';
    default:
      return '';
  }
}

export function ApplicationCard({
  application,
  onChanged,
  className,
}: {
  application: MyApplication;
  /** 결제 확인 등으로 상태가 바뀌었을 때 목록을 다시 읽게 한다. */
  onChanged?: () => void;
  className?: string;
}) {
  const toast = useToast();
  const confirmDeposit = useConfirmDepositMutation(application.id);

  const deposit = application.deposit;
  // 홀드가 열려 있는가 = 낼 돈이 남아 있고 기한이 있다.
  const holdOpen =
    (deposit.status === 'PENDING' || deposit.status === 'SHORTFALL_PENDING') &&
    deposit.dueAt !== null;

  const onPay = () => {
    confirmDeposit.mutate(undefined, {
      onSuccess: () => {
        toast.success('예약금 결제가 확인되었어요', '신청이 유효해졌습니다.');
        onChanged?.();
      },
      onError: (error) => {
        toast.error('결제를 확인하지 못했어요', toUserMessage(error));
        onChanged?.();
      },
    });
  };

  return (
    <div className={cn('rounded-lg border bg-card', className)}>
      <Link
        href={`/my/applications/${encodeURIComponent(application.id)}`}
        className="block p-4 transition-colors active:bg-accent"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <ApplicationStatusBadge status={application.status} />
              <Badge variant="outline" size="sm">
                {labelOf(EVENT_MODE_LABEL, application.event.mode)}
              </Badge>
            </div>

            <h3 className="mt-2 line-clamp-2 text-[15px] font-bold leading-snug">
              {application.event.title}
            </h3>

            {application.event.venue ? (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {application.event.venue.name}
              </p>
            ) : null}
          </div>

          <ChevronRight
            className="mt-1 h-5 w-5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        </div>

        <dl className="mt-3 space-y-1 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">내 신청 금액</dt>
            <dd className="font-bold tabular-nums">{formatWon(application.myAmount)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">신청 마감</dt>
            <dd className="tabular-nums">{formatDateTimeKo(application.event.applyEndAt)}</dd>
          </div>
        </dl>

        <div className="mt-2.5 flex items-center gap-2">
          <CompetitionRatioBadge competition={application.event.competition} />
          <p className="truncate text-xs text-muted-foreground">{statusHint(application)}</p>
        </div>
      </Link>

      {/* 예약금 카운트다운은 카드 밖으로 뺀다 — 링크 안에 버튼을 넣으면 탭이 섞인다. */}
      {holdOpen ? (
        <div className="border-t bg-amber-500/5 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-sm">
              <Clock className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span className="text-muted-foreground">남은 시간</span>
              <DepositCountdown dueAt={deposit.dueAt} onExpire={onChanged} />
            </p>
            <p className="text-sm font-bold tabular-nums">{formatWon(deposit.requiredAmount)}</p>
          </div>

          <Button
            full
            className="mt-2.5"
            loading={confirmDeposit.isPending}
            onClick={onPay}
          >
            예약금 결제하기
          </Button>
        </div>
      ) : null}

      {application.status === 'EXPIRED' ? (
        <div className="flex items-start gap-2 border-t px-4 py-3 text-sm text-muted-foreground">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>입금 기한이 지나 신청이 무효가 되었어요. 아직 신청 기간이라면 다시 신청할 수 있어요.</span>
        </div>
      ) : null}
    </div>
  );
}
