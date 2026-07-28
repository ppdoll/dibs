'use client';

import { ChevronRight, Clock, History, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { AppShell, StickyBottomBar, TopBar } from '@/components/layout';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CompetitionRatioLine,
  DepositCountdown,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  Separator,
  Skeleton,
  Textarea,
  useToast,
} from '@/components/ui';
import { toUserMessage } from '@/lib/api-client';
import {
  DEPOSIT_STATUS_LABEL,
  EVENT_MODE_LABEL,
  formatFullDateTimeKo,
  formatWon,
  labelOf,
} from '@/lib/format';
import { useRequireAuth } from '@/providers/auth-provider';
import type { BidSource, MyApplicationDetail } from '@/types/api';

import {
  ApplicationStatusBadge,
  statusHint,
} from '../../../_components/application-card';
import {
  useCancelMutation,
  useConfirmDepositMutation,
  useMyApplication,
} from '../../../_lib/queries';
import { RaiseDialog } from './raise-dialog';

/**
 * 내 신청 상세.
 *
 * ★ D-07 — 이 화면이 보여주는 금액은 전부 **내 것**이다: 내가 적어낸 금액,
 *   내가 낸 예약금, 내가 불렀던 금액의 이력. 내 순위는 없다. 내 순위는 남들의
 *   금액을 알아야 나오는 값이라, 알려주면 커트라인을 역산할 수 있다.
 */

const BID_SOURCE_LABEL: Record<BidSource, string> = {
  INITIAL_APPLY: '신청',
  RAISE: '금액 올림',
  ROLLBACK: '금액 되돌림',
  REAPPLY: '재신청',
  CANCEL: '취소',
  ADMIN_ADJUST: '운영자 조정',
};

export function ApplicationDetail({ applicationId }: { applicationId: string }) {
  const { isReady } = useRequireAuth();
  const query = useMyApplication(applicationId, isReady);

  if (!isReady || query.isPending) return <DetailSkeleton />;

  if (query.isError || !query.data) {
    return (
      <AppShell header={<TopBar showBack title="신청 상세" />}>
        <ErrorState
          title="신청 정보를 불러오지 못했어요"
          description="주소가 잘못되었거나 접근 권한이 없을 수 있어요."
          onRetry={() => void query.refetch()}
        />
      </AppShell>
    );
  }

  return <DetailBody application={query.data} onRefresh={() => void query.refetch()} />;
}

function DetailBody({
  application,
  onRefresh,
}: {
  application: MyApplicationDetail;
  onRefresh: () => void;
}) {
  const router = useRouter();
  const toast = useToast();

  const [raiseOpen, setRaiseOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelMemo, setCancelMemo] = useState('');

  const confirmDeposit = useConfirmDepositMutation(application.id);
  const cancel = useCancelMutation(application.id);

  const hold = application.openDepositHold;
  const event = application.event;

  const eventOpen = event.status === 'OPEN';
  const alive =
    application.status === 'PENDING_DEPOSIT' ||
    application.status === 'VALID' ||
    application.status === 'CONFIRMED';

  // 금액 올리기는 BID 에서, 신청 기간에, 살아 있는 신청에만 열린다. (D-06)
  const canRaise = event.mode === 'BID' && eventOpen && alive;
  const canCancel = alive;

  const onPay = () => {
    confirmDeposit.mutate(undefined, {
      onSuccess: () => {
        toast.success('예약금 결제가 확인되었어요', '신청이 유효해졌습니다.');
        onRefresh();
      },
      onError: (error) => {
        toast.error('결제를 확인하지 못했어요', toUserMessage(error));
        onRefresh();
      },
    });
  };

  const onCancel = () => {
    cancel.mutate(cancelMemo.trim() || undefined, {
      onSuccess: () => {
        setCancelOpen(false);
        toast.success('신청을 취소했어요', '다시 신청하려면 10분 후에 가능해요.');
        onRefresh();
      },
      onError: (error) => {
        toast.error('취소하지 못했어요', toUserMessage(error));
      },
    });
  };

  return (
    <AppShell
      header={<TopBar showBack backHref="/my/applications" title="신청 상세" />}
      bottom={
        canRaise || canCancel ? (
          <StickyBottomBar>
            {canCancel ? (
              <Button
                variant="outline"
                size="lg"
                className={canRaise ? 'flex-1' : 'w-full'}
                onClick={() => setCancelOpen(true)}
              >
                신청 취소
              </Button>
            ) : null}
            {canRaise ? (
              <Button size="lg" className="flex-[2]" onClick={() => setRaiseOpen(true)}>
                금액 올리기
              </Button>
            ) : null}
          </StickyBottomBar>
        ) : null
      }
    >
      <section className="py-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <ApplicationStatusBadge status={application.status} />
          <Badge variant="outline" size="sm">
            {labelOf(EVENT_MODE_LABEL, event.mode)}
          </Badge>
        </div>

        <Link
          href={`/events/${encodeURIComponent(event.slug ?? event.id)}`}
          className="mt-2 flex items-start justify-between gap-3"
        >
          <div className="min-w-0">
            <h1 className="text-lg font-extrabold leading-snug">{event.title}</h1>
            {event.venue ? (
              <p className="mt-0.5 truncate text-sm text-muted-foreground">{event.venue.name}</p>
            ) : null}
          </div>
          <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Link>

        <p className="mt-2 text-sm text-muted-foreground">{statusHint(application)}</p>
      </section>

      {/* 내 금액. 이 화면에서 가장 크게 보여야 하는 숫자다. */}
      <section className="pb-4">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">내 신청 금액</p>
          <p className="mt-0.5 text-3xl font-extrabold tabular-nums">
            {formatWon(application.myAmount)}
          </p>
          {application.rebidCount > 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              지금까지 {application.rebidCount}번 올렸어요.
            </p>
          ) : null}
        </div>
      </section>

      {/* 열린 예약금 홀드 — 지금 당장 해야 할 일 (D-05) */}
      {hold ? (
        <section className="pb-4">
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
            <p className="flex items-center gap-1.5 text-sm font-bold">
              <Clock className="h-4 w-4 text-primary" aria-hidden="true" />
              예약금 결제 기한
            </p>

            <div className="mt-2 flex items-baseline justify-between gap-3">
              <DepositCountdown dueAt={hold.dueAt} onExpire={onRefresh} className="text-2xl" />
              <span className="text-lg font-bold tabular-nums">{formatWon(hold.amountDue)}</span>
            </div>

            <p className="mt-1.5 text-xs text-muted-foreground">
              {formatFullDateTimeKo(hold.dueAt)}까지 결제하면 신청이 확정돼요.
              {hold.reason === 'RAISE_SHORTFALL'
                ? ' 결제하지 않으면 금액만 원래대로 돌아가고 신청은 유지돼요.'
                : ' 결제하지 않으면 신청이 자동으로 취소돼요.'}
            </p>

            <Button full className="mt-3" loading={confirmDeposit.isPending} onClick={onPay}>
              {formatWon(hold.amountDue)} 결제하기
            </Button>
          </div>
        </section>
      ) : null}

      <Separator />

      <section className="py-4">
        <h2 className="mb-2 text-base font-bold">예약금</h2>
        <Card>
          <CardContent className="divide-y p-0">
            <Row
              icon={<Wallet className="h-4 w-4" aria-hidden="true" />}
              label="상태"
              value={labelOf(DEPOSIT_STATUS_LABEL, application.deposit.status)}
            />
            <Row label="필요 금액" value={formatWon(application.deposit.requiredAmount)} />
            <Row label="납부한 금액" value={formatWon(application.deposit.paidAmount)} />
            {application.deposit.refundedAmount > 0 ? (
              <Row label="환불된 금액" value={formatWon(application.deposit.refundedAmount)} />
            ) : null}
          </CardContent>
        </Card>
      </section>

      <section className="pb-4">
        <h2 className="mb-2 text-base font-bold">예약 정보</h2>
        <Card>
          <CardContent className="divide-y p-0">
            <Row label="신청 기간 마감" value={formatFullDateTimeKo(event.applyEndAt)} />
            <Row
              label="이용일"
              value={event.serviceStartAt ? formatFullDateTimeKo(event.serviceStartAt) : '별도 안내'}
            />
            <Row label="정원" value={`${event.capacity.toLocaleString('ko-KR')}명`} />
          </CardContent>
        </Card>

        {/* ★ 경쟁률만. 순위는 없다. (D-07) */}
        <div className="mt-3 rounded-lg bg-muted/40 p-3.5">
          <CompetitionRatioLine competition={event.competition} />
          <p className="mt-1.5 text-xs text-muted-foreground">
            신청 기간에는 경쟁률만 공개돼요. 내 순위와 다른 분들의 금액은 볼 수 없어요.
          </p>
        </div>
      </section>

      <Separator />

      <section className="py-4 pb-8">
        <h2 className="mb-3 flex items-center gap-1.5 text-base font-bold">
          <History className="h-4 w-4" aria-hidden="true" />내 금액 기록
        </h2>

        <ol className="space-y-0">
          <TimelineItem
            title="신청함"
            at={formatFullDateTimeKo(application.appliedAt)}
            amount={null}
            first
          />

          {application.myBidHistory.map((entry) => (
            <TimelineItem
              key={entry.seq}
              title={BID_SOURCE_LABEL[entry.source] ?? entry.source}
              at={formatFullDateTimeKo(entry.bidAt)}
              amount={entry.newAmount}
              note={
                entry.previousAmount !== null && entry.deltaAmount !== null
                  ? `${formatWon(entry.previousAmount)} → ${formatWon(entry.newAmount)}`
                  : null
              }
            />
          ))}

          {application.confirmedAt ? (
            <TimelineItem
              title="확정됨"
              at={formatFullDateTimeKo(application.confirmedAt)}
              amount={null}
            />
          ) : null}

          {application.canceledAt ? (
            <TimelineItem
              title="취소함"
              at={formatFullDateTimeKo(application.canceledAt)}
              amount={null}
            />
          ) : null}
        </ol>
      </section>

      <RaiseDialog open={raiseOpen} onOpenChange={setRaiseOpen} application={application} />

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent dismissible={!cancel.isPending}>
          <DialogHeader>
            <DialogTitle>신청을 취소할까요?</DialogTitle>
            <DialogDescription>
              취소하면 지금까지의 순서가 사라져요. 다시 신청하려면 10분을 기다려야 하고,
              그때는 새로 신청한 것으로 처리돼요.
            </DialogDescription>
          </DialogHeader>

          <Textarea
            placeholder="취소 사유를 남겨 주시면 서비스 개선에 참고할게요. (선택)"
            maxLength={200}
            showCount
            value={cancelMemo}
            onChange={(e) => setCancelMemo(e.target.value)}
          />

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCancelOpen(false)}
              disabled={cancel.isPending}
            >
              그대로 둘게요
            </Button>
            <Button variant="destructive" loading={cancel.isPending} onClick={onCancel}>
              취소하기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 취소 후에는 목록으로 돌아갈 길을 남긴다. 상세가 빈 화면이 되면 갇힌 느낌이 든다. */}
      {!alive ? (
        <div className="pb-8">
          <Button variant="outline" full onClick={() => router.push('/my/applications')}>
            내 신청 목록으로
          </Button>
        </div>
      ) : null}
    </AppShell>
  );
}

function Row({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3 text-sm">
      <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="text-right font-medium tabular-nums">{value}</span>
    </div>
  );
}

/** 세로 타임라인 한 칸. 점과 선으로 순서를 보여준다. */
function TimelineItem({
  title,
  at,
  amount,
  note,
  first = false,
}: {
  title: string;
  at: string;
  amount: number | null;
  note?: string | null;
  first?: boolean;
}) {
  return (
    <li className="relative flex gap-3 pb-4 pl-1 last:pb-0">
      <div className="flex flex-col items-center">
        <span
          className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${first ? 'bg-primary' : 'bg-border'}`}
          aria-hidden="true"
        />
        <span className="mt-1 w-px flex-1 bg-border" aria-hidden="true" />
      </div>

      <div className="min-w-0 flex-1 pb-1">
        <p className="text-sm font-semibold">
          {title}
          {amount !== null ? (
            <span className="ml-2 font-bold tabular-nums">{formatWon(amount)}</span>
          ) : null}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{at}</p>
        {note ? <p className="mt-0.5 text-xs text-muted-foreground">{note}</p> : null}
      </div>
    </li>
  );
}

function DetailSkeleton() {
  return (
    <AppShell header={<TopBar showBack title="신청 상세" />}>
      <div className="space-y-4 py-4">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-7 w-4/5" />
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    </AppShell>
  );
}
