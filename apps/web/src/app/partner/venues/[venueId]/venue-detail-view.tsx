'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, ImageIcon, Send } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { PartnerShell } from '@/components/layout';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardRow, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { formatFullDateTimeKo, formatNumber } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import {
  archiveVenue,
  getVenue,
  hideVenue,
  requestVenueReview,
  restoreVenue,
  unhideVenue,
  updateVenue,
} from '../../_lib/api';
import { WEEKDAY_LABEL } from '../../_lib/labels';
import { VenueForm, type VenueFormValues } from '../../_components/venue-form';
import {
  ErrorBanner,
  InfoNote,
  PartnerPageHeader,
  VenueStatusBadge,
} from '../../_components/partner-page';
import { STALE_VERSION_MESSAGE, isStaleVersion, toPartnerMessage } from '../../_lib/errors';
import type { DayHours } from '../../_lib/types';

export function VenueDetailView({ venueId }: { venueId: string }) {
  return (
    <PartnerShell>
      <VenueDetailBody venueId={venueId} />
    </PartnerShell>
  );
}

function VenueDetailBody({ venueId }: { venueId: string }) {
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();

  const [editing, setEditing] = useState(false);
  const [confirmReview, setConfirmReview] = useState(false);

  const venue = useQuery({
    queryKey: qk.partner.venues.detail(venueId),
    queryFn: () => getVenue(venueId),
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: qk.partner.venues.all });
    await queryClient.invalidateQueries({ queryKey: qk.partner.profile });
  };

  /**
   * 저장. If-Match 에 조회로 받은 version 을 싣는다.
   *
   * 412 가 오면 폼을 닫지 않고 배너만 띄운다 — 파트너가 방금 친 내용을 날리면
   * "새로고침 후 다시 시도" 라는 안내가 사실상 "처음부터 다시 쓰라" 가 된다.
   */
  const update = useMutation({
    mutationFn: (values: VenueFormValues) => {
      const version = venue.data?.version ?? 0;
      const { businessId: _ignored, ...rest } = values;
      return updateVenue(venueId, version, rest);
    },
    onSuccess: async () => {
      await refresh();
      setEditing(false);
      success('시설 정보를 저장했어요');
    },
  });

  const transition = useMutation({
    mutationFn: (action: 'review' | 'hide' | 'unhide' | 'archive' | 'restore') => {
      switch (action) {
        case 'review':
          return requestVenueReview(venueId);
        case 'hide':
          return hideVenue(venueId);
        case 'unhide':
          return unhideVenue(venueId);
        case 'archive':
          return archiveVenue(venueId);
        case 'restore':
          return restoreVenue(venueId);
      }
    },
    onSuccess: async () => {
      await refresh();
      setConfirmReview(false);
      success('시설 상태를 바꿨어요');
    },
    onError: (error) => toastError('상태를 바꾸지 못했어요', toPartnerMessage(error)),
  });

  if (venue.isLoading) {
    return (
      <>
        <Skeleton className="mb-6 h-8 w-56" />
        <Skeleton className="mb-4 h-64" />
        <Skeleton className="h-40" />
      </>
    );
  }

  if (venue.isError) {
    return (
      <ErrorState
        title="시설 정보를 불러오지 못했어요"
        description={toPartnerMessage(venue.error)}
        onRetry={() => void venue.refetch()}
      />
    );
  }

  const data = venue.data;
  if (!data) return null;

  const coverCount = data.images.filter((image) => image.isCover).length;
  const canRequestReview = data.status === 'DRAFT';

  return (
    <div className="mx-auto max-w-3xl">
      <PartnerPageHeader
        title={data.name}
        description={`${data.sido} ${data.sigungu} · ${data.roadAddress}`}
        back={{ href: '/partner/venues', label: '내 시설' }}
        badge={<VenueStatusBadge status={data.status} />}
        actions={
          <>
            <Link
              href={`/partner/venues/${venueId}/images`}
              className={buttonVariants({ variant: 'outline' })}
            >
              <ImageIcon className="h-4 w-4" aria-hidden="true" />
              사진 관리
            </Link>
            {!editing ? (
              <Button variant="outline" onClick={() => setEditing(true)}>
                수정
              </Button>
            ) : null}
          </>
        }
      />

      {data.suspensionReason ? (
        <InfoNote className="mb-4" title="운영자 정지 사유">
          {data.suspensionReason}
        </InfoNote>
      ) : null}

      {isStaleVersion(update.error) ? (
        <ErrorBanner message={`${STALE_VERSION_MESSAGE}\n작성 중인 내용은 그대로 남겨 뒀어요.`} />
      ) : null}

      {editing ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>시설 정보 수정</CardTitle>
          </CardHeader>
          <CardContent>
            <VenueForm
              mode="edit"
              initial={data}
              businessOptions={[]}
              submitLabel="저장하기"
              submitting={update.isPending}
              error={isStaleVersion(update.error) ? null : update.error}
              onSubmit={(values) => update.mutate(values)}
              onCancel={() => setEditing(false)}
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="mb-4">
            <CardHeader>
              <CardTitle>기본 정보</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y">
                <CardRow label="한 줄 소개" value={data.summary ?? '-'} />
                <CardRow label="주소" value={`(${data.postalCode}) ${data.roadAddress} ${data.detailAddress ?? ''}`.trim()} />
                <CardRow label="전화번호" value={data.phone} />
                <CardRow label="좌석" value={data.seatCount ? `${formatNumber(data.seatCount)}석` : '-'} />
                <CardRow label="웹사이트" value={data.websiteUrl ?? '-'} />
                <CardRow label="인스타그램" value={data.instagramHandle ? `@${data.instagramHandle}` : '-'} />
                <CardRow label="사진" value={`${formatNumber(data.imageCount)}장`} />
                <CardRow label="진행 중 이벤트" value={`${formatNumber(data.openEventCount)}건`} />
                <CardRow label="검수 요청" value={formatFullDateTimeKo(data.submittedForReviewAt)} />
                <CardRow label="공개 시작" value={formatFullDateTimeKo(data.publishedAt)} />
              </dl>

              {data.description ? (
                <p className="mt-4 whitespace-pre-line border-t pt-4 text-sm leading-relaxed text-muted-foreground">
                  {data.description}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <BusinessHoursCard hours={data.businessHours} />
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle>공개 상태</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.status === 'DRAFT' ? (
            <p className="text-sm leading-relaxed text-muted-foreground">
              작성 중이라 이용자에게 보이지 않아요. 사업자 확인이 끝나고 대표 사진이 1장 이상
              있어야 검수를 요청할 수 있어요.
              {coverCount === 0 ? ' 아직 대표 사진이 지정되지 않았어요.' : ''}
            </p>
          ) : data.status === 'PENDING_REVIEW' ? (
            <p className="text-sm leading-relaxed text-muted-foreground">
              운영자가 검수하고 있어요. 결과가 나오면 알림으로 알려드릴게요.
            </p>
          ) : data.status === 'ACTIVE' ? (
            <p className="text-sm leading-relaxed text-muted-foreground">
              이용자에게 노출되고 있어요. 잠시 예약을 받지 않으려면 노출을 중단할 수 있어요.
            </p>
          ) : data.status === 'HIDDEN' ? (
            <p className="text-sm leading-relaxed text-muted-foreground">
              노출이 중단된 상태예요. 다시 켜면 바로 검색에 나와요.
            </p>
          ) : data.status === 'ARCHIVED' ? (
            <p className="text-sm leading-relaxed text-muted-foreground">
              보관된 시설이에요. 보관을 해제하면 작성 중 상태로 돌아가요.
            </p>
          ) : (
            <p className="text-sm leading-relaxed text-muted-foreground">
              운영자가 정지한 상태라 파트너가 바꿀 수 없어요.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {canRequestReview ? (
              <Button
                leadingIcon={<Send className="h-4 w-4" aria-hidden="true" />}
                onClick={() => setConfirmReview(true)}
              >
                검수 요청하기
              </Button>
            ) : null}

            {data.status === 'ACTIVE' ? (
              <Button
                variant="outline"
                loading={transition.isPending}
                leadingIcon={<EyeOff className="h-4 w-4" aria-hidden="true" />}
                onClick={() => transition.mutate('hide')}
              >
                노출 중단
              </Button>
            ) : null}

            {data.status === 'HIDDEN' ? (
              <>
                <Button
                  variant="outline"
                  loading={transition.isPending}
                  leadingIcon={<Eye className="h-4 w-4" aria-hidden="true" />}
                  onClick={() => transition.mutate('unhide')}
                >
                  노출 재개
                </Button>
                <Button
                  variant="ghost"
                  loading={transition.isPending}
                  onClick={() => transition.mutate('archive')}
                >
                  보관하기
                </Button>
              </>
            ) : null}

            {data.status === 'DRAFT' ? (
              <Button
                variant="ghost"
                loading={transition.isPending}
                onClick={() => transition.mutate('archive')}
              >
                보관하기
              </Button>
            ) : null}

            {data.status === 'ARCHIVED' ? (
              <Button
                variant="outline"
                loading={transition.isPending}
                onClick={() => transition.mutate('restore')}
              >
                보관 해제
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Dialog open={confirmReview} onOpenChange={setConfirmReview}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>검수를 요청할까요?</DialogTitle>
            <DialogDescription>
              운영자가 사진과 정보를 확인해요. 검수 중에는 이용자에게 아직 보이지 않아요.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmReview(false)}>
              취소
            </Button>
            <Button loading={transition.isPending} onClick={() => transition.mutate('review')}>
              검수 요청
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BusinessHoursCard({ hours }: { hours: DayHours[] | null }) {
  if (!hours || hours.length === 0) return null;

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>영업시간</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="divide-y">
          {hours.map((row) => (
            <CardRow
              key={row.day}
              label={`${WEEKDAY_LABEL[row.day] ?? row.day}요일`}
              value={row.closed ? '휴무' : `${row.open ?? '-'} ~ ${row.close ?? '-'}`}
            />
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
