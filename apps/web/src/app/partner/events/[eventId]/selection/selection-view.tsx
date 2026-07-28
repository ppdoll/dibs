'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Download,
  Lock,
  Minus,
  Plus,
  Sparkles,
  Timer,
  TrendingUp,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { PartnerShell } from '@/components/layout';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardRow, CardTitle } from '@/components/ui/card';
import { Countdown } from '@/components/ui/countdown';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import {
  DEPOSIT_STATUS_LABEL,
  formatDateTimeKo,
  formatFullDateTimeKo,
  formatNumber,
  formatWon,
  labelOf,
} from '@/lib/format';
import { isApiError } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import {
  addSelectionEntry,
  autoPreselect,
  exportSelectionCsv,
  finalizeSelection,
  getPartnerEvent,
  getSelectionByEvent,
  listSelectionEntries,
  promoteSelectionEntry,
  removeSelectionEntry,
} from '../../../_lib/api';
import { toPartnerMessage } from '../../../_lib/errors';
import {
  SELECTION_ROUND_STATUS_LABEL,
  SELECTION_STATUS_LABEL,
  SELECTION_STATUS_VARIANT,
} from '../../../_lib/labels';
import {
  ErrorBanner,
  InfoNote,
  PartnerPageHeader,
  StatCard,
  TableScroller,
} from '../../../_components/partner-page';
import { isRoundNotReady } from '../_lib/live-api';
import type { PartnerSelectionEntry, PartnerSelectionRound } from '../../../_lib/types';

const PAGE_SIZE = 100;

/**
 * 412 문구.
 *
 * 공용 `STALE_VERSION_MESSAGE` 는 "다른 곳에서 수정되었습니다" 다. 이 화면에서는 바뀐 것이
 * 설정이 아니라 **명단**이고, 그 차이가 파트너가 다음에 할 행동을 바꾼다(새로고침 후 순위를
 * 다시 읽고 판단해야 한다). 그래서 여기만 문구를 좁힌다.
 */
const STALE_LIST_MESSAGE = '다른 곳에서 명단이 변경되었습니다. 새로고침 후 다시 시도해 주세요';

/** 명단을 만질 수 있는 라운드 상태. 서버(EDITABLE_ROUND_STATUSES)와 같은 집합이다. */
const EDITABLE_STATUSES: PartnerSelectionRound['status'][] = ['RANKING_READY', 'DRAFT', 'REOPENED'];

type OverrideKind = 'add' | 'remove' | 'promote';

interface OverrideTarget {
  kind: OverrideKind;
  entry: PartnerSelectionEntry;
}

export function SelectionView({ eventId }: { eventId: string }) {
  return (
    <PartnerShell>
      <SelectionBody eventId={eventId} />
    </PartnerShell>
  );
}

function SelectionBody({ eventId }: { eventId: string }) {
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();

  const [topN, setTopN] = useState('');
  const [override, setOverride] = useState<OverrideTarget | null>(null);
  const [reason, setReason] = useState('');
  const [promoteFrom, setPromoteFrom] = useState('');
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [finalizeMemo, setFinalizeMemo] = useState('');
  const [banner, setBanner] = useState<string | null>(null);

  const event = useQuery({
    queryKey: qk.partner.events.detail(eventId),
    queryFn: () => getPartnerEvent(eventId),
    staleTime: 60_000,
  });

  /**
   * 라운드. **모든 변경 호출의 If-Match 토큰이 여기서 나온다.**
   *
   * 예약금 마감 전에는 404 라서 재시도하지 않는다 — 그건 실패가 아니라 "아직"이다.
   */
  const round = useQuery<PartnerSelectionRound>({
    queryKey: qk.partner.selections.byEvent(eventId),
    queryFn: () => getSelectionByEvent(eventId),
    retry: false,
  });

  const selectionId = round.data?.id ?? '';

  const entries = useInfiniteQuery({
    queryKey: qk.partner.selections.entries(selectionId || 'none', { limit: PAGE_SIZE }),
    queryFn: ({ pageParam }) =>
      listSelectionEntries(selectionId, { limit: PAGE_SIZE, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: round.isSuccess,
  });

  const rows = useMemo(
    () => (entries.data?.pages ?? []).flatMap((page) => page.items),
    [entries.data],
  );

  /** 결원 승계의 근거가 될 수 있는 엔트리 — 실제로 빠져 있는 사람만. 서버 WHERE 절과 같은 조건이다. */
  const vacancies = useMemo(
    () => rows.filter((row) => row.status === 'REVOKED' || row.status === 'NOT_SELECTED'),
    [rows],
  );

  /**
   * ★ 변경 호출의 유일한 통로.
   *
   * `version` 은 인자가 아니라 여기서 꺼낸다. 호출부가 넘기게 두면 언젠가 한 곳이
   * `?? 0` 을 적어 놓고, 그 순간부터 두 탭의 조작이 조용히 서로를 덮어쓴다.
   * 라운드를 아직 못 읽었으면 아예 던져서 **헤더 없는 요청이 나가지 않게** 한다.
   */
  const requireVersion = (): number => {
    const version = round.data?.version;
    if (version === undefined) {
      throw new Error('선정 라운드를 아직 읽지 못했습니다. 새로고침 후 다시 시도해 주세요.');
    }
    return version;
  };

  /** 변경 성공 후: 라운드는 응답으로 갈아 끼우고(다음 If-Match 토큰이다) 명단은 다시 읽는다. */
  const applyRound = async (updated: PartnerSelectionRound) => {
    queryClient.setQueryData(qk.partner.selections.byEvent(eventId), updated);
    setBanner(null);
    await queryClient.invalidateQueries({ queryKey: qk.partner.selections.all });
    await queryClient.invalidateQueries({ queryKey: qk.partner.events.detail(eventId) });
  };

  const onMutationError = (error: unknown) => {
    if (isApiError(error) && error.status === 412) {
      setBanner(STALE_LIST_MESSAGE);
      void round.refetch();
      void entries.refetch();
      return;
    }

    // 428 = If-Match 를 안 보냈다는 뜻이다. 이 화면에서는 절대 일어나면 안 되는 일이라
    // 사용자 문구로 덮지 않고 콘솔에 남긴다 — 여기 찍히면 우리 코드가 잘못된 것이다.
    if (isApiError(error) && error.status === 428) {
      console.error('[selection] If-Match 헤더 없이 요청이 나갔습니다. 코드 버그입니다.', error);
    }

    setBanner(null);
    toastError('처리하지 못했어요', toPartnerMessage(error));
  };

  const preselect = useMutation({
    mutationFn: () => {
      const parsed = Number(topN.trim());
      const limit = topN.trim() && Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
      return autoPreselect(selectionId, requireVersion(), limit);
    },
    onSuccess: async (updated) => {
      await applyRound(updated);
      success('상위 후보를 명단에 넣었어요');
    },
    onError: onMutationError,
  });

  const applyOverride = useMutation({
    mutationFn: (target: OverrideTarget) => {
      const version = requireVersion();
      const memo = reason.trim() ? reason.trim() : undefined;

      switch (target.kind) {
        case 'add':
          return addSelectionEntry(selectionId, target.entry.id, version, memo);
        case 'remove':
          return removeSelectionEntry(selectionId, target.entry.id, version, memo);
        case 'promote':
          return promoteSelectionEntry(selectionId, target.entry.id, version, {
            fromEntryId: promoteFrom,
            ...(memo ? { reason: memo } : {}),
          });
      }
    },
    onSuccess: async (updated, target) => {
      await applyRound(updated);
      setOverride(null);
      setReason('');
      setPromoteFrom('');
      success(
        target.kind === 'add'
          ? '명단에 추가했어요'
          : target.kind === 'remove'
            ? '명단에서 제외했어요'
            : '결원을 승계했어요',
      );
    },
    onError: onMutationError,
  });

  const finalize = useMutation({
    mutationFn: () =>
      finalizeSelection(
        selectionId,
        requireVersion(),
        finalizeMemo.trim() ? finalizeMemo.trim() : undefined,
      ),
    onSuccess: async (updated) => {
      await applyRound(updated);
      setFinalizeOpen(false);
      setFinalizeMemo('');
      success('명단을 확정했어요', '신청자 전원에게 결과 알림이 나가요');
    },
    onError: onMutationError,
  });

  /**
   * CSV 내려받기.
   *
   * `<a href>` 로는 안 된다 — 브라우저가 만든 그 요청에는 Authorization 헤더가 붙지 않아
   * 401 HTML 을 CSV 라며 저장한다. 본문을 토큰과 함께 받아서 Blob URL 로 넘긴다.
   */
  const download = useMutation({
    mutationFn: async () => {
      const csv = await exportSelectionCsv(selectionId);
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));

      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `dibs-명단-${round.data?.roundNo ?? 1}라운드.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();

      // 즉시 회수하면 사파리에서 저장이 취소되는 경우가 있어 한 틱 뒤에 놓아 준다.
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
    },
    onError: (error) => toastError('CSV 를 내려받지 못했어요', toPartnerMessage(error)),
  });

  if (event.isLoading || round.isLoading) {
    return (
      <>
        <Skeleton className="mb-6 h-8 w-64" />
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
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

  // ─── 아직 열리지 않음 (404) ─────────────────────────────────────────
  if (round.isError && isRoundNotReady(round.error)) {
    return <NotYetOpen event={data} eventId={eventId} onRetry={() => void round.refetch()} />;
  }

  if (round.isError) {
    return (
      <ErrorState
        title="선정 라운드를 불러오지 못했어요"
        description={toPartnerMessage(round.error)}
        onRetry={() => void round.refetch()}
      />
    );
  }

  const info = round.data;
  if (!info) return null;

  const editable = EDITABLE_STATUSES.includes(info.status);
  const finalized = info.status === 'FINALIZED';

  return (
    <>
      <PartnerPageHeader
        title="당첨자 확정"
        description={`${data.title} · ${info.roundNo}라운드`}
        back={{ href: `/partner/events/${eventId}`, label: data.title }}
        badge={
          <Badge variant={finalized ? 'success' : editable ? 'warning' : 'muted'}>
            {SELECTION_ROUND_STATUS_LABEL[info.status] ?? info.status}
          </Badge>
        }
        actions={
          <>
            <Link
              href={`/partner/events/${eventId}/applicants`}
              className={buttonVariants({ variant: 'outline' })}
            >
              <Users className="h-4 w-4" aria-hidden="true" />
              신청 현황
            </Link>
            <Button
              variant="outline"
              loading={download.isPending}
              leadingIcon={<Download className="h-4 w-4" aria-hidden="true" />}
              onClick={() => download.mutate()}
            >
              CSV 내려받기
            </Button>
          </>
        }
      />

      <ErrorBanner message={banner} />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="이번 라운드 정원"
          value={formatNumber(info.remainingSeats)}
          hint={`전체 정원 ${formatNumber(info.capacitySnapshot)}명`}
        />
        <StatCard
          label="적격 후보"
          value={formatNumber(info.eligibleCount)}
          hint={`제외 ${formatNumber(info.excludedCount)}명`}
        />
        <StatCard
          label="명단에 포함"
          value={formatNumber(info.preselectedCount)}
          hint="아직 확정 전이에요"
          tone={info.preselectedCount > info.remainingSeats ? 'warning' : 'default'}
        />
        <StatCard
          label="확정된 당첨"
          value={formatNumber(info.selectedCount)}
          hint={info.finalizedAt ? formatFullDateTimeKo(info.finalizedAt) : '아직 발표 전'}
          tone={info.selectedCount > 0 ? 'success' : 'default'}
        />
      </div>

      {/* ★ 커트라인. 이 카드가 이 화면 밖으로 나가면 밀봉입찰이 공개입찰이 된다 (D-07). */}
      <Card className="mb-5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            정원 커트라인
          </CardTitle>
        </CardHeader>
        <CardContent>
          {info.cutoff && info.cutoff.amount !== null ? (
            <dl className="divide-y">
              <CardRow label="커트라인 금액" value={formatWon(info.cutoff.amount)} />
              <CardRow
                label="그 금액에 도달한 시각"
                value={formatFullDateTimeKo(info.cutoff.lastBidAt)}
              />
              <CardRow
                label="경계 동점"
                value={info.cutoff.hasTie ? '있음 — 신청 순번으로 갈렸어요' : '없음'}
              />
            </dl>
          ) : (
            <p className="text-sm leading-relaxed text-muted-foreground">
              적격 후보가 정원보다 적어서 커트라인이 없어요. 전원이 정원 안이에요.
            </p>
          )}
          <InfoNote className="mt-4">
            커트라인은 파트너에게만 보여요. 쪽지나 안내문에 적으면 다른 신청자들이 최소 낙찰가를
            역산할 수 있어서, 발송 전에 운영자 검토로 보류돼요.
          </InfoNote>
        </CardContent>
      </Card>

      {editable ? (
        <Card className="mb-5">
          <CardHeader>
            <CardTitle>명단 만들기</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <Field
                label="상위 몇 명"
                htmlFor="topN"
                hint={`비우면 남은 정원(${formatNumber(info.remainingSeats)}명)만큼 뽑아요`}
                className="max-w-[200px]"
              >
                <Input
                  id="topN"
                  inputMode="numeric"
                  value={topN}
                  onChange={(e) => setTopN(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder={String(info.remainingSeats)}
                />
              </Field>
              <Button
                loading={preselect.isPending}
                leadingIcon={<Sparkles className="h-4 w-4" aria-hidden="true" />}
                onClick={() => preselect.mutate()}
              >
                순위대로 자동 선정
              </Button>
            </div>

            <InfoNote>
              이미 명단에 넣은 후보는 그대로 두고, 아직 후보 상태인 사람만 순위대로 채워요.
              정원을 넘기면 서버가 막아요 — 넘겨받은 자리는 결국 시설이 실제로 받을 수 있는
              인원이니까요.
            </InfoNote>
          </CardContent>
        </Card>
      ) : null}

      {entries.isPending ? (
        <TableScroller>
          <tbody>
            {Array.from({ length: 10 }).map((_, index) => (
              <tr key={index} className="border-t">
                <td className="px-3 py-3">
                  <Skeleton className="h-5 w-full" />
                </td>
              </tr>
            ))}
          </tbody>
        </TableScroller>
      ) : entries.isError ? (
        <ErrorState
          title="후보 목록을 불러오지 못했어요"
          description={toPartnerMessage(entries.error)}
          onRetry={() => void entries.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Users className="h-6 w-6" aria-hidden="true" />}
          title="후보가 없어요"
          description="유효한 신청이 하나도 없는 라운드예요."
        />
      ) : (
        <>
          <EntryTable
            rows={rows}
            remainingSeats={info.remainingSeats}
            editable={editable}
            busy={applyOverride.isPending}
            hasVacancy={vacancies.length > 0}
            onOverride={(target) => {
              setOverride(target);
              setReason('');
              setPromoteFrom(vacancies[0]?.id ?? '');
            }}
          />

          {entries.hasNextPage ? (
            <div className="mt-4 flex justify-center">
              <Button
                variant="outline"
                loading={entries.isFetchingNextPage}
                onClick={() => void entries.fetchNextPage()}
              >
                더 보기
              </Button>
            </div>
          ) : null}
        </>
      )}

      {editable ? (
        <div className="mt-6 flex flex-wrap items-center gap-3 border-t pt-6">
          <Button
            variant="primary"
            size="lg"
            disabled={info.preselectedCount === 0}
            leadingIcon={<Lock className="h-4 w-4" aria-hidden="true" />}
            onClick={() => setFinalizeOpen(true)}
          >
            명단 확정하고 발표하기
          </Button>
          <p className="text-sm text-muted-foreground">
            {info.preselectedCount === 0
              ? '명단에 아무도 없어요. 먼저 후보를 골라 주세요.'
              : `${formatNumber(info.preselectedCount)}명을 확정해요. 되돌릴 수 없어요.`}
          </p>
        </div>
      ) : finalized ? (
        <InfoNote className="mt-6" title="이미 발표된 라운드예요">
          확정된 명단은 되돌릴 수 없어요. 결원이 생겼다면 이벤트 상세에서 보충 라운드를 열어
          다음 순위를 승계하세요.
        </InfoNote>
      ) : null}

      {/* ─── 수동 조정 다이얼로그 ─────────────────────────────────── */}
      <Dialog
        open={override !== null}
        onOpenChange={(open) => {
          if (!open) setOverride(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {override?.kind === 'add'
                ? '명단에 추가할까요?'
                : override?.kind === 'remove'
                  ? '명단에서 뺄까요?'
                  : '결원을 승계할까요?'}
            </DialogTitle>
            <DialogDescription>
              {override
                ? `${override.entry.displayName} · ${formatWon(override.entry.amount)} · ${
                    override.entry.rankNo === null ? '순위 없음' : `${override.entry.rankNo}위`
                  }`
                : ''}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {override?.kind === 'promote' ? (
              <Field
                label="누구의 자리를 물려받나요"
                htmlFor="promoteFrom"
                hint="실제로 빠진 사람만 고를 수 있어요. 승계 기록이 함께 남아요."
              >
                <Select
                  id="promoteFrom"
                  value={promoteFrom}
                  onChange={(e) => setPromoteFrom(e.target.value)}
                  options={vacancies.map((row) => ({
                    value: row.id,
                    label: `${row.rankNo === null ? '-' : `${row.rankNo}위`} ${row.displayName} · ${formatWon(row.amount)}`,
                  }))}
                />
              </Field>
            ) : null}

            <Field
              label="조정 사유"
              htmlFor="overrideReason"
              hint="라운드 설정에 따라 필수예요. 감사 기록에 그대로 남아요."
            >
              <Textarea
                id="overrideReason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder="예) 시설 사정으로 인원을 한 명 늘렸습니다"
              />
            </Field>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOverride(null)}>
              닫기
            </Button>
            <Button
              variant={override?.kind === 'remove' ? 'destructive' : 'primary'}
              loading={applyOverride.isPending}
              disabled={override?.kind === 'promote' && !promoteFrom}
              onClick={() => override && applyOverride.mutate(override)}
            >
              {override?.kind === 'remove' ? '빼기' : '적용하기'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── 확정 다이얼로그 ──────────────────────────────────────── */}
      <Dialog open={finalizeOpen} onOpenChange={(open) => !open && setFinalizeOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>명단을 확정할까요?</DialogTitle>
            <DialogDescription>
              지금 명단에 있는 {formatNumber(info.preselectedCount)}명이 당첨으로 확정돼요.
            </DialogDescription>
          </DialogHeader>

          {/* 되돌릴 수 없다는 말을 흐리지 않는다. 셋 다 실제로 일어나는 일이다. */}
          <ul className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm leading-relaxed">
            <li className="flex gap-2">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
              <span>
                <strong>되돌릴 수 없어요.</strong> 확정 후에 명단을 고치려면 보충 라운드를 새로
                열어야 해요.
              </span>
            </li>
            <li className="flex gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
              <span>
                신청자 <strong>전원</strong>에게 결과 알림이 나가요. 당첨자에게도, 미당첨자에게도요.
              </span>
            </li>
            <li className="flex gap-2">
              <Minus className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
              <span>
                미당첨자의 예약금은 <strong>환불 큐</strong>에 올라가요.
              </span>
            </li>
          </ul>

          <Textarea
            value={finalizeMemo}
            onChange={(e) => setFinalizeMemo(e.target.value)}
            maxLength={1000}
            rows={3}
            placeholder="내부 메모 (선택) — 신청자에게 보이지 않아요"
          />

          <DialogFooter>
            <Button variant="outline" onClick={() => setFinalizeOpen(false)}>
              더 볼게요
            </Button>
            <Button variant="destructive" loading={finalize.isPending} onClick={() => finalize.mutate()}>
              확정하고 발표하기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── 아직 열리지 않은 상태 ────────────────────────────────────────────

/**
 * 404 는 오류가 아니다.
 *
 * 순위는 마감이 아니라 **예약금 입금 시간이 모두 지난 뒤**에 확정된다(D-04). 마감 1분 전에
 * 신청한 사람도 입금 시간을 온전히 써야 하기 때문이다. 그 사이에 이 화면을 연 파트너에게
 * "찾을 수 없음"을 보여주면 뭔가 잘못된 줄 안다 — 언제 열리는지와 남은 시간을 준다.
 */
function NotYetOpen({
  event,
  eventId,
  onRetry,
}: {
  event: { title: string; applyEndAt: string; rankingLockAt: string | null };
  eventId: string;
  onRetry: () => void;
}) {
  return (
    <>
      <PartnerPageHeader
        title="당첨자 확정"
        description={event.title}
        back={{ href: `/partner/events/${eventId}`, label: event.title }}
        badge={<Badge variant="muted">아직 열리지 않음</Badge>}
      />

      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col items-center py-6 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Timer className="h-6 w-6" aria-hidden="true" />
            </div>
            <p className="text-base font-semibold">예약금 마감이 지나면 명단이 열려요</p>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
              순위는 신청 마감이 아니라{' '}
              <strong className="text-foreground">예약금 입금 시간이 모두 지난 뒤</strong>에
              확정돼요. 마감 직전에 신청한 분도 입금 시간을 온전히 쓸 수 있어야 하니까요.
            </p>

            {event.rankingLockAt ? (
              <div className="mt-6">
                <p className="text-sm text-muted-foreground">순위 확정까지</p>
                <Countdown target={event.rankingLockAt} className="mt-1 text-2xl font-bold" />
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatFullDateTimeKo(event.rankingLockAt)}
                </p>
              </div>
            ) : (
              <p className="mt-6 text-sm text-muted-foreground">
                신청 마감 {formatFullDateTimeKo(event.applyEndAt)} 이후에 확정 시각이 정해져요.
              </p>
            )}

            <div className="mt-7 flex flex-wrap justify-center gap-2">
              <Button variant="outline" onClick={onRetry}>
                다시 확인
              </Button>
              <Link
                href={`/partner/events/${eventId}/applicants`}
                className={buttonVariants({ variant: 'primary' })}
              >
                <Users className="h-4 w-4" aria-hidden="true" />
                지금 신청 현황 보기
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>

      <InfoNote className="mt-5" title="그동안 무엇을 볼 수 있나요">
        &lsquo;신청 현황&rsquo; 화면에서 누가 얼마에 신청했는지 지금도 볼 수 있어요. 다만 그 순위는
        잠정이에요 — 금액은 마감 전까지 올릴 수 있고, 예약금을 못 낸 신청은 빠지니까요.
      </InfoNote>
    </>
  );
}

// ─── 후보 표 ──────────────────────────────────────────────────────────

/**
 * 순위순 후보 표.
 *
 * 정원 커트라인을 **줄로 그린다.** 배지나 색만으로는 "몇 번째까지가 정원 안인가"를 눈으로
 * 셀 수 없고, 그 경계가 이 화면에서 파트너가 내리는 거의 모든 판단의 기준이다.
 */
function EntryTable({
  rows,
  remainingSeats,
  editable,
  busy,
  hasVacancy,
  onOverride,
}: {
  rows: PartnerSelectionEntry[];
  remainingSeats: number;
  editable: boolean;
  busy: boolean;
  hasVacancy: boolean;
  onOverride: (target: OverrideTarget) => void;
}) {
  // 커트라인 줄은 정원 번째 줄 **바로 아래** 한 번만 그린다. 순위 없는 줄(제외 후보)이
  // 뒤에 섞여 있어서 인덱스가 아니라 rankNo 로 판정해야 한다.
  let cutoffDrawn = false;

  return (
    <TableScroller>
      <thead>
        <tr className="bg-muted/50 text-left text-xs font-semibold text-muted-foreground">
          <th className="px-3 py-2">순위</th>
          <th className="px-3 py-2">신청자</th>
          <th className="px-3 py-2 text-right">금액</th>
          <th className="px-3 py-2">금액 도달</th>
          <th className="px-3 py-2">예약금</th>
          <th className="px-3 py-2">심사 상태</th>
          {editable ? <th className="px-3 py-2 text-right">조정</th> : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const drawCutoff =
            !cutoffDrawn && row.rankNo !== null && row.rankNo > remainingSeats && remainingSeats > 0;
          if (drawCutoff) cutoffDrawn = true;

          return (
            <ExpandableRow
              key={row.id}
              row={row}
              editable={editable}
              busy={busy}
              hasVacancy={hasVacancy}
              cutoffBefore={drawCutoff}
              remainingSeats={remainingSeats}
              onOverride={onOverride}
            />
          );
        })}
      </tbody>
    </TableScroller>
  );
}

function ExpandableRow({
  row,
  editable,
  busy,
  hasVacancy,
  cutoffBefore,
  remainingSeats,
  onOverride,
}: {
  row: PartnerSelectionEntry;
  editable: boolean;
  busy: boolean;
  hasVacancy: boolean;
  cutoffBefore: boolean;
  remainingSeats: number;
  onOverride: (target: OverrideTarget) => void;
}) {
  const inList = row.status === 'PRESELECTED' || row.status === 'SELECTED';
  const columns = editable ? 7 : 6;

  return (
    <>
      {cutoffBefore ? (
        <tr>
          <td colSpan={columns} className="p-0">
            <div className="flex items-center gap-2 border-y-2 border-dashed border-amber-500/60 bg-amber-500/5 px-3 py-1.5">
              <span className="text-xs font-bold text-amber-700 dark:text-amber-400">
                ─ 정원 커트라인 ({formatNumber(remainingSeats)}명) ─
              </span>
              <span className="text-xs text-muted-foreground">
                여기 아래는 정원 밖이에요. 넣으려면 수동 추가가 필요해요.
              </span>
            </div>
          </td>
        </tr>
      ) : null}

      <tr className={`border-t align-middle ${inList ? 'bg-primary/[0.04]' : ''}`}>
        <td className="px-3 py-3 font-semibold tabular-nums">
          {row.rankNo === null ? <span className="text-muted-foreground">-</span> : row.rankNo}
        </td>
        <td className="px-3 py-3">
          <span className={row.isEligible ? '' : 'text-muted-foreground line-through'}>
            {row.displayName}
          </span>
          {row.isOverride ? (
            <Badge variant="outline" size="sm" className="ml-1.5">
              수동
            </Badge>
          ) : null}
          {row.exclusionReason ? (
            <p className="mt-0.5 text-xs text-muted-foreground">제외: {row.exclusionReason}</p>
          ) : null}
        </td>
        <td className="px-3 py-3 text-right font-semibold tabular-nums">{formatWon(row.amount)}</td>
        <td className="px-3 py-3 text-muted-foreground">
          <span title={formatFullDateTimeKo(row.lastBidAt)}>{formatDateTimeKo(row.lastBidAt)}</span>
          {row.rebidCount > 0 ? (
            <span className="ml-1 text-xs">(상향 {row.rebidCount}회)</span>
          ) : null}
        </td>
        <td className="px-3 py-3">
          <Badge variant={row.depositStatus === 'PAID' ? 'success' : 'muted'}>
            {labelOf(DEPOSIT_STATUS_LABEL, row.depositStatus)}
          </Badge>
        </td>
        <td className="px-3 py-3">
          <Badge variant={SELECTION_STATUS_VARIANT[row.status] ?? 'muted'}>
            {SELECTION_STATUS_LABEL[row.status] ?? row.status}
          </Badge>
        </td>

        {editable ? (
          <td className="px-3 py-3">
            <div className="flex justify-end gap-1.5">
              {inList ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  leadingIcon={<Minus className="h-3.5 w-3.5" aria-hidden="true" />}
                  onClick={() => onOverride({ kind: 'remove', entry: row })}
                >
                  빼기
                </Button>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy || !row.isEligible}
                    leadingIcon={<Plus className="h-3.5 w-3.5" aria-hidden="true" />}
                    onClick={() => onOverride({ kind: 'add', entry: row })}
                  >
                    넣기
                  </Button>
                  {hasVacancy ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy || !row.isEligible}
                      onClick={() => onOverride({ kind: 'promote', entry: row })}
                    >
                      승계
                    </Button>
                  ) : null}
                </>
              )}
            </div>
          </td>
        ) : null}
      </tr>
    </>
  );
}
