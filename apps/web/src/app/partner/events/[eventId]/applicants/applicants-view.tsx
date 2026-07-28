'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ChevronsUpDown, Mail, Megaphone, Users } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { PartnerShell } from '@/components/layout';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Countdown } from '@/components/ui/countdown';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Chip, ChipGroup } from '@/components/ui/tabs';
import {
  APPLICATION_STATUS_LABEL,
  DEPOSIT_STATUS_LABEL,
  formatDateTimeKo,
  formatFullDateTimeKo,
  formatNumber,
  formatWon,
  labelOf,
} from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { getPartnerEvent, getSelectionByEvent, listSelectionEntries } from '../../../_lib/api';
import { toPartnerMessage } from '../../../_lib/errors';
import { SELECTION_STATUS_LABEL, SELECTION_STATUS_VARIANT } from '../../../_lib/labels';
import {
  InfoNote,
  PartnerPageHeader,
  StatCard,
  TableScroller,
} from '../../../_components/partner-page';
import {
  isRoundNotReady,
  listLiveApplicants,
  type LiveApplicant,
  type LiveApplicantBucket,
  type LiveApplicantSummary,
} from '../_lib/live-api';
import type { PartnerSelectionEntry, PartnerSelectionRound } from '../../../_lib/types';

const PAGE_SIZE = 50;

/**
 * 표에 그리는 한 줄. 라이브 목록과 확정 라운드 목록을 같은 모양으로 눌러 담는다.
 *
 * `position` 의 뜻이 두 출처에서 다르다는 것이 이 화면의 핵심이라, 값을 합치면서도
 * `provisional` 플래그를 같이 들고 다닌다 — 잠정인지 확정인지를 모른 채 숫자만 보여주면
 * 파트너가 그 숫자를 신청자에게 알려주게 되고, 그때 D-07 이 깨진다.
 */
interface ApplicantRow {
  key: string;
  position: number | null;
  name: string;
  amount: number;
  appliedAt: string;
  lastBidAt: string;
  /** 유저에게 보여주는 상태 문구 */
  statusLabel: string;
  statusVariant: 'muted' | 'warning' | 'success' | 'destructive' | 'secondary' | 'default';
  depositLabel: string;
  depositSettled: boolean;
  depositPaid: number;
  /** 확정 라운드에서만 뜻이 있다. 정원 안쪽인가. */
  withinCapacity: boolean | null;
}

type SortKey = 'position' | 'name' | 'amount' | 'appliedAt' | 'status' | 'deposit';
type SortDir = 'asc' | 'desc';

export function ApplicantsView({ eventId }: { eventId: string }) {
  return (
    <PartnerShell>
      <ApplicantsBody eventId={eventId} />
    </PartnerShell>
  );
}

function ApplicantsBody({ eventId }: { eventId: string }) {
  const [bucket, setBucket] = useState<LiveApplicantBucket | 'ALL'>('ALL');
  const [eligibleOnly, setEligibleOnly] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: 'position',
    dir: 'asc',
  });

  const event = useQuery({
    queryKey: qk.partner.events.detail(eventId),
    queryFn: () => getPartnerEvent(eventId),
    staleTime: 30_000,
  });

  /**
   * 라운드가 이미 열렸는가.
   *
   * 예약금 마감 전에는 404 가 정상이므로 재시도하지 않는다 — 재시도하면 "아직 안 열렸다"를
   * 확인하는 데 3번을 쓰고, 그동안 화면이 로딩으로 멈춰 있다.
   */
  const round = useQuery<PartnerSelectionRound>({
    queryKey: qk.partner.selections.byEvent(eventId),
    queryFn: () => getSelectionByEvent(eventId),
    retry: false,
    staleTime: 30_000,
  });

  const roundReady = round.isSuccess;
  const roundSettled = round.isFetched;

  /** 라운드 이전 — 살아 있는 신청을 그대로 읽는다. 순위는 잠정이다. */
  const liveParams = { bucket: bucket === 'ALL' ? undefined : bucket, limit: PAGE_SIZE };

  const live = useInfiniteQuery({
    queryKey: [...qk.partner.selections.byEvent(eventId), 'live-applicants', liveParams],
    queryFn: ({ pageParam, signal }) =>
      listLiveApplicants(eventId, { ...liveParams, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: roundSettled && !roundReady,
    // 신청이 실시간으로 들어오고 금액도 올라간다. SSE 가 없으므로 짧은 주기로 다시 읽는다(D-11).
    refetchInterval: 30_000,
  });

  /** 라운드가 열린 뒤 — 얼어붙은 스냅샷을 읽는다. 순위는 확정이다. */
  const entryParams = { eligibleOnly: eligibleOnly || undefined, limit: PAGE_SIZE };

  const entries = useInfiniteQuery({
    queryKey: qk.partner.selections.entries(round.data?.id ?? 'none', entryParams),
    queryFn: ({ pageParam }) =>
      listSelectionEntries(round.data?.id ?? '', { ...entryParams, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: roundReady,
    staleTime: 30_000,
  });

  /**
   * 두 쿼리를 하나의 상태로 눌러 담는다.
   *
   * `roundReady ? entries : live` 로 그냥 합치면 두 `useInfiniteQuery` 의 제네릭이 달라
   * `refetch()` 같은 메서드가 호출 불가능한 합집합 타입이 된다. 화면이 실제로 쓰는 값만
   * 꺼내 두면 그 문제가 사라지고, 어떤 출처든 아래 JSX 는 똑같이 동작한다.
   */
  const source = roundReady
    ? {
        isPending: entries.isPending,
        isError: entries.isError,
        error: entries.error as unknown,
        hasNextPage: entries.hasNextPage,
        isFetchingNextPage: entries.isFetchingNextPage,
        refetch: () => void entries.refetch(),
        fetchNextPage: () => void entries.fetchNextPage(),
      }
    : {
        isPending: live.isPending,
        isError: live.isError,
        error: live.error as unknown,
        hasNextPage: live.hasNextPage,
        isFetchingNextPage: live.isFetchingNextPage,
        refetch: () => void live.refetch(),
        fetchNextPage: () => void live.fetchNextPage(),
      };

  const rows = useMemo<ApplicantRow[]>(() => {
    if (roundReady) {
      return (entries.data?.pages ?? []).flatMap((page) => page.items.map(toRowFromEntry));
    }
    return (live.data?.pages ?? []).flatMap((page) => page.items.map(toRowFromLive));
  }, [roundReady, entries.data, live.data]);

  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort]);

  const summary = live.data?.pages[0]?.summary ?? null;

  if (event.isLoading || !roundSettled) {
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

  // 라운드 조회가 404 가 아닌 이유로 실패했다면 그건 진짜 오류다. 조용히 라이브로 넘어가면
  // 파트너는 확정된 명단 대신 잠정 순위를 보고 판단하게 된다.
  if (round.isError && !isRoundNotReady(round.error)) {
    return (
      <ErrorState
        title="선정 라운드를 확인하지 못했어요"
        description={toPartnerMessage(round.error)}
        onRetry={() => void round.refetch()}
      />
    );
  }

  const data = event.data;
  if (!data) return null;

  const provisional = !roundReady;
  const capacity = summary?.capacity ?? data.capacity;

  return (
    <>
      <PartnerPageHeader
        title="신청 현황"
        description={`${data.title} · 누가 얼마에 신청했는지 확인해요`}
        back={{ href: `/partner/events/${eventId}`, label: data.title }}
        badge={
          provisional ? (
            <Badge variant="warning">잠정 순위</Badge>
          ) : (
            <Badge variant="success">순위 확정됨</Badge>
          )
        }
        actions={
          <>
            <Link
              href={`/partner/events/${eventId}/selection`}
              className={buttonVariants({ variant: 'outline' })}
            >
              <Megaphone className="h-4 w-4" aria-hidden="true" />
              당첨자 확정
            </Link>
            <Link
              href={`/partner/events/${eventId}/messages`}
              className={buttonVariants({ variant: 'outline' })}
            >
              <Mail className="h-4 w-4" aria-hidden="true" />
              쪽지
            </Link>
          </>
        }
      />

      {/* ★ 잠정이라는 사실을 숫자보다 먼저 읽히게 둔다. 표 안의 배지 하나로는 부족하다. */}
      {provisional ? (
        <div className="mb-5 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
          <p className="text-sm font-semibold">지금 보이는 순위는 잠정 순위예요</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            신청 금액은 마감 전까지 올릴 수 있고, 예약금을 못 낸 신청은 시간이 지나면 빠져요.
            순위는{' '}
            <strong className="text-foreground">
              {data.rankingLockAt ? formatFullDateTimeKo(data.rankingLockAt) : '예약금 마감'}
            </strong>
            에 확정돼요.
            {data.status === 'OPEN' ? (
              <>
                {' '}
                신청 마감까지 <Countdown target={data.applyEndAt} className="font-semibold" />
              </>
            ) : null}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            이 숫자는 이벤트 주인인 파트너에게만 보여요. 신청자에게 순위·금액·커트라인을 알려주면
            안 돼요 (D-07).
          </p>
        </div>
      ) : null}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="정원" value={formatNumber(capacity)} hint="이번 라운드에서 뽑을 인원" />
        <StatCard
          label="유효 신청"
          value={formatNumber(summary?.validCount ?? data.liveApplicantCount)}
          hint="순위 집계에 들어가는 신청"
        />
        <StatCard
          label="예약금 미납"
          value={formatNumber(summary?.pendingDepositCount ?? 0)}
          hint="시간이 지나면 무효가 돼요"
          tone={(summary?.pendingDepositCount ?? 0) > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="경쟁률"
          value={ratioText(summary, data.competitionRatioX10)}
          hint={`정원 ${formatNumber(capacity)}명 기준`}
        />
      </div>

      <ChipGroup className="mb-4">
        {provisional ? (
          <>
            <Chip selected={bucket === 'ALL'} onClick={() => setBucket('ALL')}>
              전체
            </Chip>
            <Chip selected={bucket === 'RANKED'} onClick={() => setBucket('RANKED')}>
              유효 신청
            </Chip>
            <Chip
              selected={bucket === 'PENDING_DEPOSIT'}
              onClick={() => setBucket('PENDING_DEPOSIT')}
            >
              예약금 미납
            </Chip>
          </>
        ) : (
          <>
            <Chip selected={!eligibleOnly} onClick={() => setEligibleOnly(false)}>
              전체
            </Chip>
            <Chip selected={eligibleOnly} onClick={() => setEligibleOnly(true)}>
              적격 후보만
            </Chip>
          </>
        )}
      </ChipGroup>

      {source.isPending ? (
        <TableScroller>
          <Header sort={sort} onSort={setSort} provisional={provisional} />
          <tbody>
            {Array.from({ length: 8 }).map((_, index) => (
              <tr key={index} className="border-t">
                <td colSpan={6} className="px-3 py-3">
                  <Skeleton className="h-5 w-full" />
                </td>
              </tr>
            ))}
          </tbody>
        </TableScroller>
      ) : source.isError ? (
        <ErrorState
          title="신청자 목록을 불러오지 못했어요"
          description={toPartnerMessage(source.error)}
          onRetry={source.refetch}
        />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={<Users className="h-6 w-6" aria-hidden="true" />}
          title="아직 신청이 없어요"
          description={
            bucket === 'PENDING_DEPOSIT'
              ? '예약금을 안 낸 신청이 없어요. 좋은 신호예요.'
              : '신청이 들어오면 금액순으로 여기 쌓여요.'
          }
        />
      ) : (
        <>
          <TableScroller>
            <Header sort={sort} onSort={setSort} provisional={provisional} />
            <tbody>
              {sorted.map((row) => (
                <tr key={row.key} className="border-t align-middle">
                  <td className="px-3 py-3 tabular-nums">
                    {row.position === null ? (
                      <span className="text-muted-foreground">-</span>
                    ) : (
                      <span
                        className={
                          row.withinCapacity === false
                            ? 'font-semibold text-muted-foreground'
                            : 'font-semibold'
                        }
                      >
                        {row.position}
                        {provisional ? (
                          <span className="ml-1 text-xs font-normal text-amber-600 dark:text-amber-400">
                            잠정
                          </span>
                        ) : null}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3">{row.name}</td>
                  <td className="px-3 py-3 text-right font-semibold tabular-nums">
                    {formatWon(row.amount)}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    <span title={formatFullDateTimeKo(row.appliedAt)}>
                      {formatDateTimeKo(row.appliedAt)}
                    </span>
                    {row.lastBidAt !== row.appliedAt ? (
                      <span className="ml-1 text-xs">
                        (금액 도달 {formatDateTimeKo(row.lastBidAt)})
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-3">
                    <Badge variant={row.statusVariant}>{row.statusLabel}</Badge>
                  </td>
                  <td className="px-3 py-3">
                    <Badge variant={row.depositSettled ? 'success' : 'warning'}>
                      {row.depositSettled ? '납부 완료' : row.depositLabel}
                    </Badge>
                    {row.depositPaid > 0 ? (
                      <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">
                        {formatWon(row.depositPaid)}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableScroller>

          {/*
            정렬 버튼은 **지금 불러온 줄 안에서만** 동작한다. 서버 정렬은 언제나 D-04 의 정렬
            (금액 내림차순 → 금액 도달 시각 → 신청 순번)이고, 그게 유일하게 순위와 일치하는 순서다.
          */}
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            표의 정렬은 지금 불러온 {formatNumber(sorted.length)}줄 안에서만 적용돼요. 순위 기준
            정렬(금액 → 같은 금액이면 먼저 부른 순서)로 돌아가려면 &lsquo;
            {provisional ? '잠정순위' : '순위'}&rsquo;를 눌러 주세요.
          </p>

          {source.hasNextPage ? (
            <div className="mt-4 flex justify-center">
              <Button
                variant="outline"
                loading={source.isFetchingNextPage}
                onClick={source.fetchNextPage}
              >
                더 보기
              </Button>
            </div>
          ) : null}
        </>
      )}

      {!provisional ? (
        <InfoNote className="mt-5" title="순위가 확정된 목록이에요">
          예약금 마감이 지나 순위가 얼어붙었어요. 여기 보이는 순서가 그대로 명단의 기준이 돼요.
          최종 명단을 정하려면 &lsquo;당첨자 확정&rsquo; 화면으로 가 주세요.
        </InfoNote>
      ) : null}
    </>
  );
}

// ─── 표 머리 ──────────────────────────────────────────────────────────

function Header({
  sort,
  onSort,
  provisional,
}: {
  sort: { key: SortKey; dir: SortDir };
  onSort: (next: { key: SortKey; dir: SortDir }) => void;
  provisional: boolean;
}) {
  const columns: Array<{ key: SortKey; label: string; align?: 'right' }> = [
    { key: 'position', label: provisional ? '잠정순위' : '순위' },
    { key: 'name', label: '신청자' },
    { key: 'amount', label: '금액', align: 'right' },
    { key: 'appliedAt', label: '신청 시각' },
    { key: 'status', label: '상태' },
    { key: 'deposit', label: '예약금 납부' },
  ];

  return (
    <thead>
      <tr className="bg-muted/50 text-left text-xs text-muted-foreground">
        {columns.map((column) => {
          const active = sort.key === column.key;

          return (
            <th key={column.key} className="px-3 py-2 font-semibold">
              <button
                type="button"
                className={`inline-flex items-center gap-1 transition-colors hover:text-foreground ${
                  column.align === 'right' ? 'w-full justify-end' : ''
                } ${active ? 'text-foreground' : ''}`}
                onClick={() =>
                  onSort({
                    key: column.key,
                    // 같은 열을 다시 누르면 방향만 뒤집는다.
                    dir: active && sort.dir === 'asc' ? 'desc' : 'asc',
                  })
                }
                aria-label={`${column.label} 기준 정렬`}
              >
                {column.label}
                {active ? (
                  sort.dir === 'asc' ? (
                    <ArrowUp className="h-3 w-3" aria-hidden="true" />
                  ) : (
                    <ArrowDown className="h-3 w-3" aria-hidden="true" />
                  )
                ) : (
                  <ChevronsUpDown className="h-3 w-3 opacity-40" aria-hidden="true" />
                )}
              </button>
            </th>
          );
        })}
      </tr>
    </thead>
  );
}

// ─── 변환 · 정렬 ──────────────────────────────────────────────────────

/** 라이브 신청 → 표 한 줄. 순위는 잠정이다. */
function toRowFromLive(item: LiveApplicant): ApplicantRow {
  return {
    key: item.applicationId,
    position: item.provisionalPosition,
    name: item.displayName,
    amount: item.amount,
    appliedAt: item.appliedAt,
    lastBidAt: item.lastBidAt,
    statusLabel: labelOf(APPLICATION_STATUS_LABEL, item.status),
    statusVariant: item.status === 'PENDING_DEPOSIT' ? 'warning' : 'success',
    depositLabel: labelOf(DEPOSIT_STATUS_LABEL, item.depositStatus),
    depositSettled: item.depositSettled,
    depositPaid: item.depositPaid,
    withinCapacity: null,
  };
}

/** 확정 라운드 엔트리 → 표 한 줄. 순위는 얼어붙은 값이다. */
function toRowFromEntry(entry: PartnerSelectionEntry): ApplicantRow {
  return {
    key: entry.id,
    position: entry.rankNo,
    name: entry.displayName,
    amount: entry.amount,
    appliedAt: entry.appliedAt,
    lastBidAt: entry.lastBidAt,
    statusLabel: SELECTION_STATUS_LABEL[entry.status] ?? entry.status,
    statusVariant: SELECTION_STATUS_VARIANT[entry.status] ?? 'muted',
    depositLabel: labelOf(DEPOSIT_STATUS_LABEL, entry.depositStatus),
    // 라운드 스냅샷에는 "완납 여부" 플래그가 없다. 예약금 상태가 곧 그 답이다.
    depositSettled: entry.depositStatus === 'PAID' || entry.depositStatus === 'NOT_REQUIRED',
    depositPaid: entry.depositPaid,
    withinCapacity: entry.withinCapacity,
  };
}

/**
 * 화면 안 정렬.
 *
 * 기본값(순위 오름차순)은 **서버가 준 순서 그대로**를 쓴다. 복사해서 다시 정렬하면
 * 순위가 없는 줄(예약금 미납)의 위치가 브라우저 정렬 구현에 따라 흔들리고,
 * 그건 D-04 의 순서와 화면이 갈라지는 첫 걸음이다.
 */
function sortRows(rows: ApplicantRow[], sort: { key: SortKey; dir: SortDir }): ApplicantRow[] {
  if (sort.key === 'position' && sort.dir === 'asc') return rows;

  const factor = sort.dir === 'asc' ? 1 : -1;

  return [...rows].sort((a, b) => {
    switch (sort.key) {
      case 'position':
        // null(순위 없음)은 방향과 무관하게 언제나 뒤로 보낸다.
        if (a.position === null) return 1;
        if (b.position === null) return -1;
        return (a.position - b.position) * factor;
      case 'name':
        return a.name.localeCompare(b.name, 'ko') * factor;
      case 'amount':
        return (a.amount - b.amount) * factor;
      case 'appliedAt':
        return (Date.parse(a.appliedAt) - Date.parse(b.appliedAt)) * factor;
      case 'status':
        return a.statusLabel.localeCompare(b.statusLabel, 'ko') * factor;
      case 'deposit':
        return (Number(a.depositSettled) - Number(b.depositSettled)) * factor;
      default:
        return 0;
    }
  });
}

/** 경쟁률 한 줄. 라이브 요약이 없으면 이벤트 통계값으로 대체한다. */
function ratioText(summary: LiveApplicantSummary | null, fallbackX10: number | null): string {
  const x10 = summary?.competitionRatioX10 ?? fallbackX10;
  if (x10 === null || x10 === undefined) return '집계 전';
  return `${(x10 / 10).toFixed(1)}:1`;
}
