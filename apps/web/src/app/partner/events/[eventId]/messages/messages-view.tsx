'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Bell, CheckCircle2, Mail, Send, Users } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { PartnerShell } from '@/components/layout';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Chip, ChipGroup } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { newIdempotencyKey } from '@/lib/api-client';
import { formatNumber } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { getPartnerEvent, getSelectionByEvent } from '../../../_lib/api';
import { toFieldErrors, toPartnerMessage } from '../../../_lib/errors';
import {
  ErrorBanner,
  InfoNote,
  PartnerPageHeader,
} from '../../../_components/partner-page';
import { listLiveApplicants, sendEventBroadcast } from '../_lib/live-api';
import type { NotificationChannel, SendEventMessageResult } from '../../../_lib/types';
import type { ApplicationStatus } from '@/types/api';

const TITLE_MAX = 120;
const BODY_MAX = 4000;

/**
 * 수신자 묶음.
 *
 * 상태를 하나씩 고르게 하지 않는 이유는 실무다 — 파트너가 실제로 쓰는 발송은
 * "선정되신 분들께 준비물 안내" 와 "예약금 미납자에게 리마인드" 두 가지고,
 * `ApplicationStatus` 8개를 그대로 늘어놓으면 EVENT_CANCELED 같은 값에 체크가 들어간다.
 */
const AUDIENCES: Array<{
  id: string;
  label: string;
  hint: string;
  statuses?: ApplicationStatus[];
}> = [
  { id: 'ALL', label: '전체 신청자', hint: '취소·만료된 분까지 포함해요' },
  {
    id: 'ACTIVE',
    label: '유효 신청자',
    hint: '예약금까지 낸, 순위에 들어가는 분들',
    statuses: ['VALID', 'CONFIRMED'],
  },
  {
    id: 'PENDING_DEPOSIT',
    label: '예약금 미납',
    hint: '입금 시간이 지나면 신청이 무효가 돼요',
    statuses: ['PENDING_DEPOSIT'],
  },
  { id: 'CONFIRMED', label: '당첨자', hint: '발표가 끝난 뒤에만 있어요', statuses: ['CONFIRMED'] },
  {
    id: 'NOT_SELECTED',
    label: '미당첨자',
    hint: '환불 안내처럼 결과 이후 안내에 써요',
    statuses: ['NOT_SELECTED'],
  },
  {
    id: 'CLOSED',
    label: '만료 · 취소',
    hint: '다음 이벤트 안내 정도로만 써 주세요',
    statuses: ['EXPIRED', 'CANCELED'],
  },
];

export function EventMessagesView({ eventId }: { eventId: string }) {
  return (
    <PartnerShell>
      <MessagesBody eventId={eventId} />
    </PartnerShell>
  );
}

function MessagesBody({ eventId }: { eventId: string }) {
  const { success } = useToast();

  const [audienceId, setAudienceId] = useState('ACTIVE');
  const [channels, setChannels] = useState<NotificationChannel[]>(['IN_APP', 'EMAIL']);
  const [titleKo, setTitleKo] = useState('');
  const [bodyKo, setBodyKo] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<SendEventMessageResult | null>(null);

  /**
   * 멱등키.
   *
   * 이 문구 한 통을 가리키는 값이라 **작성 중에는 바뀌지 않는다.** 발송이 실패해서 다시 눌러도
   * 같은 키로 나가야 서버가 두 번째 요청을 첫 응답으로 되돌려준다 — 매번 새로 만들면
   * "실패한 줄 알고 다시 눌렀는데 쪽지가 두 통 갔다" 가 된다.
   * 성공한 뒤에는 새 문구를 위해 새로 뽑는다.
   */
  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey());

  const event = useQuery({
    queryKey: qk.partner.events.detail(eventId),
    queryFn: () => getPartnerEvent(eventId),
    staleTime: 60_000,
  });

  /** 수신자 수 미리보기용. 목록은 필요 없으므로 한 줄만 받아 요약만 쓴다. */
  const live = useQuery({
    queryKey: [...qk.partner.selections.byEvent(eventId), 'live-applicants', 'summary'],
    queryFn: ({ signal }) => listLiveApplicants(eventId, { limit: 1 }, signal),
    staleTime: 30_000,
  });

  /** 당첨자 수는 확정된 라운드에만 있다. 아직 없으면 404 라서 재시도하지 않는다. */
  const round = useQuery({
    queryKey: qk.partner.selections.byEvent(eventId),
    queryFn: () => getSelectionByEvent(eventId),
    retry: false,
  });

  const audience = AUDIENCES.find((item) => item.id === audienceId) ?? AUDIENCES[0]!;

  const estimate = useMemo<number | null>(() => {
    const summary = live.data?.summary;
    const detail = event.data;

    switch (audience.id) {
      case 'ALL':
        return detail?.totalApplicationCount ?? null;
      case 'ACTIVE':
        return summary?.validCount ?? null;
      case 'PENDING_DEPOSIT':
        return summary?.pendingDepositCount ?? null;
      case 'CONFIRMED':
        return round.data?.selectedCount ?? null;
      case 'CLOSED':
        return detail ? detail.expiredCount + detail.canceledCount : null;
      default:
        // 미당첨자 수는 어느 응답에도 단독으로 들어 있지 않다. 모르는 값을 지어내지 않는다.
        return null;
    }
  }, [audience.id, live.data, event.data, round.data]);

  const send = useMutation({
    mutationFn: () =>
      sendEventBroadcast(eventId, {
        titleKo: titleKo.trim(),
        bodyKo: bodyKo.trim(),
        ...(audience.statuses ? { applicationStatuses: audience.statuses } : {}),
        channels,
        idempotencyKey,
      }),
    onSuccess: (sent) => {
      setResult(sent);
      setConfirmOpen(false);
      setIdempotencyKey(newIdempotencyKey());

      if (isHeld(sent.status)) {
        // 보류는 실패가 아니다. 토스트로 "성공" 이라고 말하면 파트너가 발송된 줄 안다.
        return;
      }

      setTitleKo('');
      setBodyKo('');
      success('쪽지를 보냈어요', `${formatNumber(sent.totalRecipients)}명에게 전달돼요`);
    },
  });

  /**
   * 문구를 다시 고치기 시작하면 지난 발송 결과 카드를 치운다.
   *
   * `useEffect` 로 하지 않는 이유: 보류(BLOCKED)된 발송은 문구를 그대로 남겨 두는데,
   * 효과로 처리하면 결과 카드가 뜨자마자 스스로 사라진다. 사용자가 실제로 타이핑한
   * 순간에만 치우는 게 맞다.
   */
  const editTitle = (value: string) => {
    setResult(null);
    setTitleKo(value.slice(0, TITLE_MAX));
  };

  const editBody = (value: string) => {
    setResult(null);
    setBodyKo(value.slice(0, BODY_MAX));
  };

  if (event.isLoading) {
    return (
      <>
        <Skeleton className="mb-6 h-8 w-64" />
        <Skeleton className="mb-4 h-32" />
        <Skeleton className="h-96" />
      </>
    );
  }

  if (event.isError) {
    return (
      <ErrorState
        title="이벤트를 불러오지 못했어요"
        description={toPartnerMessage(event.error)}
        onRetry={() => void event.refetch()}
      />
    );
  }

  const data = event.data;
  if (!data) return null;

  const fieldErrors = toFieldErrors(send.error);
  const ready = titleKo.trim().length > 0 && bodyKo.trim().length > 0 && channels.length > 0;

  return (
    <>
      <PartnerPageHeader
        title="신청자에게 쪽지"
        description={`${data.title} · 앱 알림과 이메일로 나가요`}
        back={{ href: `/partner/events/${eventId}`, label: data.title }}
        actions={
          <Link
            href={`/partner/events/${eventId}/applicants`}
            className={buttonVariants({ variant: 'outline' })}
          >
            <Users className="h-4 w-4" aria-hidden="true" />
            신청 현황
          </Link>
        }
      />

      {/* ★ D-07. 기계가 강제할 수 없는 규칙이라 쓰기 전에 한 줄로 말해 둔다. */}
      <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
        <AlertTriangle
          className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400"
          aria-hidden="true"
        />
        <div className="text-sm leading-relaxed">
          <p className="font-semibold">커트라인이나 다른 사람의 금액은 쓸 수 없어요</p>
          <p className="mt-1 text-muted-foreground">
            &lsquo;커트라인&rsquo;, &lsquo;낙찰가&rsquo;, &lsquo;○○위&rsquo; 같은 표현이나 금액과
            순위가 함께 있는 문장이 보이면 바로 나가지 않고 운영자 검토로 넘어가요. 신청 기간에
            공개되는 건 경쟁률뿐이라, 한 통이 나가는 순간 그 이벤트의 모든 신청자가 최소 금액을
            역산할 수 있게 되거든요. 보낸 쪽지는 회수할 수 없어서 미리 잡아 둬요.
          </p>
        </div>
      </div>

      {send.error && Object.keys(fieldErrors).length === 0 ? (
        <ErrorBanner message={toPartnerMessage(send.error)} />
      ) : null}

      {result ? <SendResultCard result={result} /> : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader>
            <CardTitle>내용</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="제목" htmlFor="titleKo" required>
              <Input
                id="titleKo"
                value={titleKo}
                onChange={(e) => editTitle(e.target.value)}
                maxLength={TITLE_MAX}
                placeholder="예) 이용 안내드립니다"
                {...(fieldErrors.titleKo ? { error: fieldErrors.titleKo } : {})}
              />
            </Field>

            <Field
              label="본문"
              htmlFor="bodyKo"
              required
              hint="줄바꿈은 그대로 전달돼요. 이메일에도 같은 문구가 나가요."
            >
              <Textarea
                id="bodyKo"
                value={bodyKo}
                onChange={(e) => editBody(e.target.value)}
                maxLength={BODY_MAX}
                showCount
                rows={12}
                placeholder={
                  '예) 안녕하세요, 신청해 주셔서 감사합니다.\n이용 당일 준비물과 오시는 길을 안내드려요.'
                }
                {...(fieldErrors.bodyKo ? { error: fieldErrors.bodyKo } : {})}
              />
            </Field>
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>받는 사람</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ChipGroup>
                {AUDIENCES.map((item) => (
                  <Chip
                    key={item.id}
                    selected={audienceId === item.id}
                    onClick={() => setAudienceId(item.id)}
                  >
                    {item.label}
                  </Chip>
                ))}
              </ChipGroup>

              <p className="text-sm text-muted-foreground">{audience.hint}</p>

              <div className="rounded-lg bg-muted/60 p-3.5">
                <p className="text-sm text-muted-foreground">예상 수신자</p>
                {live.isLoading ? (
                  <Skeleton className="mt-1 h-8 w-24" />
                ) : (
                  <p className="mt-0.5 text-2xl font-bold tabular-nums">
                    {estimate === null ? '—' : `${formatNumber(estimate)}명`}
                  </p>
                )}
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {estimate === null
                    ? '이 묶음은 미리 셀 수 없어요. 실제 인원은 보낸 뒤 결과에 나와요.'
                    : '지금 기준 추정치예요. 실제 인원은 보내는 순간에 다시 계산돼요.'}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>보내는 방법</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ChipGroup>
                <Chip
                  selected={channels.includes('IN_APP')}
                  className="inline-flex items-center gap-1.5"
                  onClick={() => setChannels(toggleChannel(channels, 'IN_APP'))}
                >
                  <Bell className="h-3.5 w-3.5" aria-hidden="true" />앱 알림
                </Chip>
                <Chip
                  selected={channels.includes('EMAIL')}
                  className="inline-flex items-center gap-1.5"
                  onClick={() => setChannels(toggleChannel(channels, 'EMAIL'))}
                >
                  <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                  이메일
                </Chip>
              </ChipGroup>

              <InfoNote>
                어떤 방법을 골라도 앱 안의 쪽지함에는 항상 한 통이 남아요. 이메일을 켜면 메일도
                함께 나가요. 마케팅 수신을 끈 분에게는 안내성 쪽지만 전달돼요.
              </InfoNote>
            </CardContent>
          </Card>

          <Button
            full
            size="lg"
            disabled={!ready}
            leadingIcon={<Send className="h-4 w-4" aria-hidden="true" />}
            onClick={() => setConfirmOpen(true)}
          >
            발송 확인하기
          </Button>
        </div>
      </div>

      {/* ─── 발송 확인 ────────────────────────────────────────────── */}
      <Dialog open={confirmOpen} onOpenChange={(open) => !open && setConfirmOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>이대로 보낼까요?</DialogTitle>
            <DialogDescription>
              {audience.label}
              {estimate === null ? '' : ` · 약 ${formatNumber(estimate)}명`} ·{' '}
              {channels.includes('EMAIL') ? '앱 알림 + 이메일' : '앱 알림'}
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border p-3.5">
            <p className="text-sm font-semibold">{titleKo}</p>
            <p className="mt-1.5 max-h-40 overflow-y-auto whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
              {bodyKo}
            </p>
          </div>

          <p className="text-sm leading-relaxed text-muted-foreground">
            보낸 쪽지는 회수할 수 없어요. 커트라인·순위·다른 사람의 금액이 들어 있으면 발송 대신
            운영자 검토로 넘어가요.
          </p>

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              다시 볼게요
            </Button>
            <Button loading={send.isPending} onClick={() => send.mutate()}>
              보내기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── 발송 결과 ────────────────────────────────────────────────────────

/** 운영자 검토로 넘어간 상태. 발송 실패가 아니라 "아직 안 나감" 이다. */
function isHeld(status: string): boolean {
  return status === 'BLOCKED' || status === 'PENDING_APPROVAL';
}

function SendResultCard({ result }: { result: SendEventMessageResult }) {
  const held = isHeld(result.status);

  return (
    <div
      className={`mb-5 flex items-start gap-2.5 rounded-lg border p-4 ${
        held ? 'border-amber-500/40 bg-amber-500/5' : 'border-emerald-500/40 bg-emerald-500/5'
      }`}
      role="status"
    >
      {held ? (
        <AlertTriangle
          className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400"
          aria-hidden="true"
        />
      ) : (
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" aria-hidden="true" />
      )}

      <div className="text-sm leading-relaxed">
        <p className="font-semibold">
          {held ? '운영자 검토로 넘어갔어요' : '쪽지를 보냈어요'}
          <Badge variant={held ? 'warning' : 'success'} size="sm" className="ml-2">
            {result.status}
          </Badge>
        </p>
        <p className="mt-1 text-muted-foreground">
          {held ? (
            <>
              {result.moderationNote ?? '문구에 확인이 필요한 표현이 있어요.'} 아직 아무에게도 나가지
              않았어요. 운영자가 확인하면 그대로 발송되고, 결과는 알림으로 알려드려요.
            </>
          ) : (
            <>
              수신자 {formatNumber(result.totalRecipients)}명 · 발송{' '}
              {formatNumber(result.sentCount)}건
              {result.suppressedCount > 0
                ? ` · 수신 거부 ${formatNumber(result.suppressedCount)}건`
                : ''}
              {result.failedCount > 0 ? ` · 실패 ${formatNumber(result.failedCount)}건` : ''}
            </>
          )}
        </p>
      </div>
    </div>
  );
}

function toggleChannel(
  channels: NotificationChannel[],
  channel: NotificationChannel,
): NotificationChannel[] {
  if (channels.includes(channel)) {
    const next = channels.filter((item) => item !== channel);
    // 채널을 전부 끄면 서버가 무엇으로 보낼지 정할 수 없다. 최소 하나는 남긴다.
    return next.length > 0 ? next : channels;
  }
  return [...channels, channel];
}
