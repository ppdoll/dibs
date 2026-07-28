'use client';

import { Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';

import { Button, SkeletonList, useToast } from '@/components/ui';
import { apiGet, toUserMessage } from '@/lib/api-client';
import { formatNumber } from '@/lib/format';
import { qk } from '@/lib/query-keys';

import { AdminPage, FilterSelect, Notice, Panel, SearchField, Toolbar } from '../_components/console';
import { CursorPager } from '../_components/data-table';
import { AUDIT_ACTOR_ROLE_LABEL, AUDIT_TARGET_TYPE_LABEL, toOptions } from '../_lib/labels';
import { useFilters } from '../_lib/use-cursor';
import type {
  AdminAuditPage,
  AdminAuditRow,
  AuditActorRole,
  AuditTargetType,
} from '../_lib/types';
import { ActionFilter } from './_components/action-filter';
import { AuditTable } from './_components/audit-table';
import { ChainVerifyPanel } from './_components/chain-verify';

/**
 * 감사 로그 뷰어.
 *
 * 콘솔의 다른 목록과 성격이 다르다. 여기서는 **아무것도 조치하지 않는다** — 읽기만 한다.
 * 그래서 행에 버튼이 없고, 대신 행을 펼쳐 before/after JSON 을 보는 것이 전부다.
 *
 * 페이지네이션 커서가 `cursor` 가 아니라 `beforeSeq` 인 점이 다른 화면과 유일하게 다르다.
 * AuditLog 의 전순서는 `seq`(BigInt)이고, id·createdAt 으로 페이징하면 같은 밀리초에
 * 들어온 두 행의 순서가 뒤집혀 "체인 순서대로 읽는다"는 이 화면의 존재 이유가 깨진다.
 */

const PAGE_SIZE = 50;

/** 서버가 내보내기 응답을 100행으로 자른다. 화면 문구도 그 숫자에 맞춘다. */
const EXPORT_LIMIT = 100;

export default function AdminAuditLogsPage() {
  return (
    <Suspense fallback={<SkeletonList count={6} />}>
      <AuditViewer />
    </Suspense>
  );
}

function AuditViewer() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { toast, error: toastError } = useToast();

  // 다른 콘솔 화면에서 "이 대상의 기록만 보기"로 넘어올 수 있게 쿼리스트링을 초기값으로 받는다.
  const { filters, setFilter, resetFilters, cursor } = useFilters({
    actorUserId: searchParams?.get('actorUserId') ?? '',
    actorRole: (searchParams?.get('actorRole') ?? '') as AuditActorRole | '',
    action: searchParams?.get('action') ?? '',
    targetType: (searchParams?.get('targetType') ?? '') as AuditTargetType | '',
    targetId: searchParams?.get('targetId') ?? '',
    correlationId: '',
    from: '',
    to: '',
  });

  // 서버는 targetType 없이 targetId 만 오면 400 이다(인덱스를 못 타고 테이블을 통째로 훑는다).
  // 그 규칙을 화면에서도 그대로 지켜, 조건이 안 맞으면 아예 보내지 않는다.
  const targetIdUsable = filters.targetType !== '' && filters.targetId.trim().length > 0;

  const fromIso = toIso(filters.from);
  const toIsoValue = toIso(filters.to);
  const rangeInvalid =
    fromIso !== '' && toIsoValue !== '' && new Date(fromIso).getTime() > new Date(toIsoValue).getTime();

  const serverQuery = useMemo(
    () => ({
      actorUserId: filters.actorUserId.trim(),
      actorRole: filters.actorRole,
      action: filters.action,
      targetType: filters.targetType,
      targetId: targetIdUsable ? filters.targetId.trim() : '',
      correlationId: filters.correlationId.trim(),
      from: fromIso,
      to: toIsoValue,
    }),
    [filters, targetIdUsable, fromIso, toIsoValue],
  );

  const query = useQuery({
    queryKey: qk.admin.auditLogs({ ...serverQuery, beforeSeq: cursor.cursor }),
    queryFn: () =>
      apiGet<AdminAuditPage>('/api/admin/audit-logs', {
        query: { ...serverQuery, beforeSeq: cursor.cursor, limit: PAGE_SIZE },
      }),
    // 기간이 거꾸로면 서버에 물어볼 것도 없다.
    enabled: !rangeInvalid,
  });

  /**
   * 내보내기.
   *
   * `<a href>` 로는 못 한다 — 브라우저가 만드는 그 요청에는 Authorization 헤더가 붙지 않아
   * 401 로 떨어진다. 그래서 api-client 로 받아서 Blob 으로 만들어 내려받게 한다.
   * 그리고 이건 조회가 아니라 **조치**다. 서버가 `AUDIT_EXPORTED` 감사 행을 남기므로
   * useQuery 로 걸어 두면 화면을 열 때마다 반출 기록이 쌓인다.
   */
  const exportLogs = useMutation({
    mutationFn: () =>
      apiGet<AdminAuditPage>('/api/admin/audit-logs/export', {
        query: { ...serverQuery, limit: EXPORT_LIMIT },
      }),
    retry: false,
    onSuccess: async (page) => {
      downloadJson(page.items);
      // 방금 남은 AUDIT_EXPORTED 행이 목록에도 바로 보여야 앞뒤가 맞는다.
      await queryClient.invalidateQueries({ queryKey: qk.admin.all });
      toast({
        title: `${formatNumber(page.items.length)}행을 내려받았습니다`,
        variant: 'success',
        description: '내보낸 사실도 감사 로그에 남았습니다.',
      });
    },
    onError: (error) => toastError('내보내지 못했습니다', toUserMessage(error)),
  });

  const filtersActive =
    serverQuery.actorUserId !== '' ||
    serverQuery.actorRole !== '' ||
    serverQuery.action !== '' ||
    serverQuery.targetType !== '' ||
    serverQuery.targetId !== '' ||
    serverQuery.correlationId !== '' ||
    filters.from !== '' ||
    filters.to !== '';

  return (
    <AdminPage
      title="감사 로그"
      description="누가 · 언제 · 무엇을 바꿨는지의 원본 기록입니다. 이 화면에서는 아무것도 바꿀 수 없어요."
      actions={
        <Button
          variant="outline"
          size="sm"
          loading={exportLogs.isPending}
          onClick={() => exportLogs.mutate()}
          leadingIcon={<Download className="h-4 w-4" aria-hidden="true" />}
        >
          현재 조건 내보내기
        </Button>
      }
    >
      <ChainVerifyPanel />

      <Panel title="필터">
        <div className="space-y-3">
          <Toolbar>
            <SearchField
              value={filters.actorUserId}
              onSubmit={(value) => setFilter('actorUserId', value)}
              label="행위자 계정 ID"
              placeholder="clx… (계정 화면에서 복사)"
            />
            <FilterSelect
              label="행위자 구분"
              value={filters.actorRole}
              allLabel="전체"
              options={toOptions(AUDIT_ACTOR_ROLE_LABEL)}
              onChange={(value) => setFilter('actorRole', value as AuditActorRole | '')}
            />
            <ActionFilter value={filters.action} onChange={(value) => setFilter('action', value)} />
          </Toolbar>

          <Toolbar>
            <FilterSelect
              label="대상 종류"
              value={filters.targetType}
              allLabel="전체"
              options={toOptions(AUDIT_TARGET_TYPE_LABEL)}
              onChange={(value) => {
                setFilter('targetType', value as AuditTargetType | '');
                // 종류를 지우면 대상 ID 는 서버가 받지 않는다. 남겨 두면 "걸었는데 안 먹는" 필터가 된다.
                if (value === '') setFilter('targetId', '');
              }}
            />
            <SearchField
              value={filters.targetId}
              onSubmit={(value) => setFilter('targetId', value)}
              label="대상 ID"
              placeholder={filters.targetType === '' ? '대상 종류를 먼저 고르세요' : 'clx…'}
            />
            <SearchField
              value={filters.correlationId}
              onSubmit={(value) => setFilter('correlationId', value)}
              label="연관 요청 ID"
              placeholder="펼친 상세에서 복사해 붙여넣기"
            />
          </Toolbar>

          <Toolbar>
            <DateField
              label="시작 (이 시각 이후)"
              value={filters.from}
              onChange={(value) => setFilter('from', value)}
            />
            <DateField
              label="종료 (이 시각 이전)"
              value={filters.to}
              onChange={(value) => setFilter('to', value)}
            />
            {filtersActive ? (
              <Button variant="ghost" size="sm" className="h-9" onClick={resetFilters}>
                필터 모두 지우기
              </Button>
            ) : null}
          </Toolbar>

          {filters.targetId.trim().length > 0 && filters.targetType === '' ? (
            <Notice tone="warning">
              대상 ID 만으로는 조회할 수 없습니다. 인덱스를 타지 못해 테이블 전체를 훑게 되기
              때문이에요. <strong>대상 종류</strong>를 함께 골라 주세요.
            </Notice>
          ) : null}

          {rangeInvalid ? (
            <Notice tone="danger">시작 시각이 종료 시각보다 뒤입니다. 기간을 다시 확인해 주세요.</Notice>
          ) : null}

          <p className="text-xs text-muted-foreground">
            기간은 이 브라우저의 시간대로 입력하고 UTC 로 바꿔 보냅니다. 내보내기는 지금 걸린 조건
            그대로 최대 {formatNumber(EXPORT_LIMIT)}행을 JSON 파일로 내려받습니다 — 파일에는 금액·연락처가
            가공 없이 들어가고, 내보낸 사실 자체가 감사 로그에 남습니다.
          </p>
        </div>
      </Panel>

      <Panel bodyClassName="p-0">
        <AuditTable
          rows={rangeInvalid ? [] : query.data?.items}
          isLoading={query.isPending && !rangeInvalid}
          isFetching={query.isFetching}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      </Panel>

      <CursorPager
        page={cursor.page}
        canPrev={cursor.canPrev}
        hasMore={query.data?.hasMore ?? false}
        onPrev={cursor.prev}
        onNext={() => cursor.next(query.data?.nextCursor ?? null)}
        isFetching={query.isFetching}
        countOnPage={query.data?.items.length ?? 0}
      />
    </AdminPage>
  );
}

/** 기간 입력. datetime-local 은 시간대가 없는 값이라, 보낼 때 이 브라우저 기준으로 해석한다. */
function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="min-w-[12rem]">
      <label className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
        <input
          type="datetime-local"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 focus:ring-offset-background"
        />
      </label>
    </div>
  );
}

/** datetime-local 문자열 → ISO8601. 비었거나 이상하면 빈 문자열(= 쿼리에서 빠진다). */
function toIso(local: string): string {
  if (!local) return '';

  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

/**
 * 받아 온 JSON 을 파일로 내려준다.
 *
 * `URL.createObjectURL` 로 만든 주소는 되돌려주지 않으면 탭이 살아 있는 동안 메모리를
 * 잡고 있는다. 큰 로그를 여러 번 내보내는 화면이라 클릭마다 반드시 해제한다.
 */
function downloadJson(rows: AdminAuditRow[]): void {
  const blob = new Blob([JSON.stringify(rows, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `dibs-audit-${fileStamp()}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  URL.revokeObjectURL(url);
}

/** 파일명용 시각. 콜론은 윈도우 파일명에 못 쓰므로 숫자만 남긴다. */
function fileStamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');

  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
  ].join('');
}
