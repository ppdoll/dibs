'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Lock, Mail, Megaphone, Rocket, Trash2, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { PartnerShell } from '@/components/layout';
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
import { ErrorState } from '@/components/ui/empty-state';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import {
  DEPOSIT_STATUS_LABEL,
  EVENT_MODE_LABEL,
  formatAmountRule,
  formatCapacity,
  formatFullDateTimeKo,
  formatNumber,
  formatWon,
} from '@/lib/format';
import { qk } from '@/lib/query-keys';
import {
  cancelEvent,
  closeEvent,
  createEventImageTicket,
  deleteEventDraft,
  deleteEventImage,
  getPartnerEvent,
  listCategories,
  listEventImages,
  publishEvent,
  registerEventImage,
  reorderEventImages,
  setEventImageCover,
  updateEvent,
} from '../../_lib/api';
import { EVENT_CANCEL_REASON_LABEL, PARTNER_CANCEL_REASONS } from '../../_lib/labels';
import { EventForm, type EventFormValues } from '../../_components/event-form';
import { ImageManager, type ImageAdapter, type ManagedImage } from '../../_components/image-manager';
import {
  ErrorBanner,
  EventStatusBadge,
  InfoNote,
  PartnerPageHeader,
  StatCard,
} from '../../_components/partner-page';
import { readImageSize, uploadToBlob } from '../../_lib/blob';
import { STALE_VERSION_MESSAGE, isStaleVersion, toPartnerMessage } from '../../_lib/errors';
import type { EventCancelReason, PartnerEventDetail } from '../../_lib/types';

const MAX_EVENT_IMAGES = 30;

export function EventDetailView({ eventId }: { eventId: string }) {
  return (
    <PartnerShell>
      <EventDetailBody eventId={eventId} />
    </PartnerShell>
  );
}

function EventDetailBody({ eventId }: { eventId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();

  const [tab, setTab] = useState('overview');
  const [dialog, setDialog] = useState<'publish' | 'close' | 'cancel' | 'delete' | null>(null);
  const [closeMemo, setCloseMemo] = useState('');
  const [cancelReason, setCancelReason] = useState<EventCancelReason>('PARTNER_REQUEST');
  const [cancelMemo, setCancelMemo] = useState('');

  const event = useQuery({
    queryKey: qk.partner.events.detail(eventId),
    queryFn: () => getPartnerEvent(eventId),
    // 신청 인원이 실시간으로 늘어난다. SSE 가 없으므로 짧은 주기로 다시 읽는다.
    refetchInterval: 30_000,
  });

  const categories = useQuery({
    queryKey: qk.catalog.categories,
    queryFn: () => listCategories(),
    staleTime: 10 * 60_000,
  });

  const categoryOptions = useMemo(() => {
    const flat: { value: string; label: string }[] = [];
    for (const parent of categories.data ?? []) {
      if (parent.children.length === 0) {
        flat.push({ value: parent.id, label: parent.nameKo });
        continue;
      }
      for (const child of parent.children) {
        flat.push({ value: child.id, label: `${parent.nameKo} · ${child.nameKo}` });
      }
    }
    return flat;
  }, [categories.data]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.partner.events.all });

  const update = useMutation({
    mutationFn: (values: EventFormValues) => {
      const version = event.data?.version ?? 0;
      const { venueId: _venue, mode: _mode, ...rest } = values;
      return updateEvent(eventId, version, rest);
    },
    onSuccess: async () => {
      await refresh();
      setTab('overview');
      success('이벤트를 저장했어요');
    },
  });

  const lifecycle = useMutation({
    mutationFn: async (action: 'publish' | 'close' | 'cancel' | 'delete') => {
      const version = event.data?.version ?? 0;
      switch (action) {
        case 'publish':
          return publishEvent(eventId, version);
        case 'close':
          return closeEvent(eventId, version, closeMemo.trim() ? { memo: closeMemo.trim() } : {});
        case 'cancel':
          return cancelEvent(eventId, version, {
            reason: cancelReason,
            ...(cancelMemo.trim() ? { memo: cancelMemo.trim() } : {}),
          });
        case 'delete':
          return deleteEventDraft(eventId, version);
      }
    },
    onSuccess: async (_result, action) => {
      await refresh();
      setDialog(null);
      if (action === 'delete') {
        success('초안을 삭제했어요');
        router.push('/partner/events');
        return;
      }
      success(
        action === 'publish'
          ? '이벤트를 공개했어요'
          : action === 'close'
            ? '신청을 마감했어요'
            : '이벤트를 취소했어요',
      );
    },
    onError: (error) => toastError('처리하지 못했어요', toPartnerMessage(error)),
  });

  const imageAdapter = useMemo<ImageAdapter>(
    () => ({
      queryKey: qk.partner.events.images(eventId),
      maxImages: MAX_EVENT_IMAGES,
      list: async (): Promise<ManagedImage[]> => {
        const rows = await listEventImages(eventId);
        return rows
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((row) => ({
            id: row.id,
            url: row.blobUrl,
            alt: row.altText,
            sortOrder: row.sortOrder,
            isCover: row.isCover,
          }));
      },
      upload: async (file) => {
        const ticket = await createEventImageTicket(eventId, file.type);
        const size = await readImageSize(file);
        const uploaded = await uploadToBlob({
          pathname: ticket.pathname,
          clientToken: ticket.clientToken,
          file,
        });
        return registerEventImage(eventId, {
          imageId: ticket.imageId,
          blobUrl: uploaded.url,
          width: size.width,
          height: size.height,
        });
      },
      reorder: (imageIds) => reorderEventImages(eventId, imageIds),
      setCover: (imageId) => setEventImageCover(eventId, imageId),
      remove: (imageId) => deleteEventImage(eventId, imageId),
    }),
    [eventId],
  );

  if (event.isLoading) {
    return (
      <>
        <Skeleton className="mb-6 h-8 w-64" />
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
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

  const canEdit = data.status === 'DRAFT' || data.status === 'SCHEDULED' || data.status === 'OPEN';

  return (
    <>
      <PartnerPageHeader
        title={data.title}
        description={`${EVENT_MODE_LABEL[data.mode]} · ${formatCapacity(data.capacity)} · ${amountRule(data)}`}
        back={{ href: '/partner/events', label: '이벤트' }}
        badge={<EventStatusBadge status={data.status} />}
        actions={
          <>
            <Link
              href={`/partner/events/${eventId}/applicants`}
              className={buttonVariants({ variant: 'outline' })}
            >
              <Users className="h-4 w-4" aria-hidden="true" />
              신청 현황
            </Link>
            {/*
              당첨자 확정은 예약금 마감 뒤에만 실제로 열리지만, 링크는 상태와 무관하게 둔다.
              조건부로 감추면 파트너가 "발표는 어디서 하나" 를 찾아 헤매고, 그 화면 안에서
              "언제 열리는지 + 남은 시간" 을 설명해 주는 편이 훨씬 낫다.
            */}
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

      {data.suspendedReason ? (
        <InfoNote className="mb-4" title="운영자 정지 사유">
          {data.suspendedReason}
        </InfoNote>
      ) : null}

      {isStaleVersion(update.error) || isStaleVersion(lifecycle.error) ? (
        <ErrorBanner message={STALE_VERSION_MESSAGE} />
      ) : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatCard
          label="유효한 신청"
          value={formatNumber(data.liveApplicantCount)}
          hint={`정원 ${formatNumber(data.capacity)}명`}
        />
        <StatCard
          label="전체 신청"
          value={formatNumber(data.totalApplicationCount)}
          hint={`만료 ${formatNumber(data.expiredCount)} · 취소 ${formatNumber(data.canceledCount)}`}
        />
        <StatCard
          label={data.status === 'OPEN' ? '마감까지' : '마감'}
          value={
            data.status === 'OPEN' ? (
              <Countdown target={data.applyEndAt} className="text-2xl" />
            ) : (
              <span className="text-base font-semibold">{formatFullDateTimeKo(data.applyEndAt)}</span>
            )
          }
          hint={
            data.softCloseExtensionCount > 0
              ? `자동 연장 ${data.softCloseExtensionCount}회 적용됨`
              : undefined
          }
        />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList scrollable className="mb-4">
          <TabsTrigger value="overview">요약</TabsTrigger>
          <TabsTrigger value="images">사진</TabsTrigger>
          <TabsTrigger value="edit" disabled={!canEdit}>
            수정
          </TabsTrigger>
          <TabsTrigger value="lifecycle">공개 · 마감</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewPanel event={data} />
        </TabsContent>

        <TabsContent value="images">
          <Card>
            <CardContent className="p-4 md:p-6">
              <ImageManager adapter={imageAdapter} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="edit">
          <Card>
            <CardContent className="p-4 md:p-6">
              {data.status !== 'DRAFT' ? (
                <InfoNote className="mb-5" title="진행 중이라 일부 항목이 잠겨요">
                  이미 공개된 이벤트는 금액 규칙을 바꿀 수 없고, 예약금 입금 시간을 줄이거나
                  마감을 앞당길 수도 없어요. 이미 신청한 사람의 조건이 뒤늦게 나빠지면 안 되니까요.
                </InfoNote>
              ) : null}

              <EventForm
                mode="edit"
                initial={data}
                venueOptions={[]}
                categoryOptions={categoryOptions}
                submitLabel="저장하기"
                submitting={update.isPending}
                error={isStaleVersion(update.error) ? null : update.error}
                onSubmit={(values) => update.mutate(values)}
                onCancel={() => setTab('overview')}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="lifecycle">
          <Card>
            <CardHeader>
              <CardTitle>공개 · 마감</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {data.status === 'DRAFT' ? (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  아직 이용자에게 보이지 않아요. 공개하면 신청 시작 시각에 맞춰 자동으로 열려요.
                </p>
              ) : data.status === 'SCHEDULED' ? (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {formatFullDateTimeKo(data.applyStartAt)}에 신청이 열려요.
                </p>
              ) : data.status === 'OPEN' ? (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  신청을 받고 있어요. 조기 마감하면 새 신청만 막히고, 이미 진행 중인 예약금 시계와
                  순위 확정 시각은 그대로예요.
                </p>
              ) : data.status === 'CLOSED' ? (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  마감됐어요. 예약금 입금 시간이 모두 지나면 순위가 확정되고 당첨자 발표 화면이 열려요.
                </p>
              ) : (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  더 이상 바꿀 수 없는 상태예요.
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                {data.status === 'DRAFT' ? (
                  <>
                    <Button
                      leadingIcon={<Rocket className="h-4 w-4" aria-hidden="true" />}
                      onClick={() => setDialog('publish')}
                    >
                      공개하기
                    </Button>
                    <Button
                      variant="ghost"
                      className="text-destructive"
                      leadingIcon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                      onClick={() => setDialog('delete')}
                    >
                      초안 삭제
                    </Button>
                  </>
                ) : null}

                {data.status === 'OPEN' ? (
                  <Button
                    variant="outline"
                    leadingIcon={<Lock className="h-4 w-4" aria-hidden="true" />}
                    onClick={() => setDialog('close')}
                  >
                    조기 마감
                  </Button>
                ) : null}

                {data.status === 'CLOSED' || data.status === 'FINALIZED' ? (
                  <Link
                    href={`/partner/events/${eventId}/selection`}
                    className={buttonVariants({ variant: 'primary' })}
                  >
                    <Megaphone className="h-4 w-4" aria-hidden="true" />
                    당첨자 발표로 가기
                  </Link>
                ) : null}

                {['SCHEDULED', 'OPEN', 'CLOSED'].includes(data.status) ? (
                  <Button
                    variant="ghost"
                    className="text-destructive"
                    leadingIcon={<Ban className="h-4 w-4" aria-hidden="true" />}
                    onClick={() => setDialog('cancel')}
                  >
                    이벤트 취소
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* 공개 확인 */}
      <Dialog open={dialog === 'publish'} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>이벤트를 공개할까요?</DialogTitle>
            <DialogDescription>
              공개하면 이용자가 볼 수 있어요. 공개 후에는 금액 규칙을 바꿀 수 없고 마감을 앞당길 수 없어요.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              취소
            </Button>
            <Button loading={lifecycle.isPending} onClick={() => lifecycle.mutate('publish')}>
              공개하기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 조기 마감 */}
      <Dialog open={dialog === 'close'} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>지금 마감할까요?</DialogTitle>
            <DialogDescription>
              새 신청만 막혀요. 이미 신청한 분들의 예약금 시계는 그대로 흘러가요.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={closeMemo}
            onChange={(event) => setCloseMemo(event.target.value)}
            maxLength={500}
            rows={3}
            placeholder="내부 메모 (선택) — 이용자에게 보이지 않아요"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              취소
            </Button>
            <Button loading={lifecycle.isPending} onClick={() => lifecycle.mutate('close')}>
              마감하기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 취소 */}
      <Dialog open={dialog === 'cancel'} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>이벤트를 취소할까요?</DialogTitle>
            <DialogDescription>
              되돌릴 수 없어요. 신청이 모두 종료되고 신청자 전원에게 알림이 나가요.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Select
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value as EventCancelReason)}
              options={PARTNER_CANCEL_REASONS.map((reason) => ({
                value: reason,
                label: EVENT_CANCEL_REASON_LABEL[reason],
              }))}
            />
            <Textarea
              value={cancelMemo}
              onChange={(event) => setCancelMemo(event.target.value)}
              maxLength={500}
              rows={3}
              placeholder="내부 메모 (선택)"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              닫기
            </Button>
            <Button
              variant="destructive"
              loading={lifecycle.isPending}
              onClick={() => lifecycle.mutate('cancel')}
            >
              취소하기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 초안 삭제 */}
      <Dialog open={dialog === 'delete'} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>초안을 삭제할까요?</DialogTitle>
            <DialogDescription>공개된 적 없는 초안만 삭제할 수 있어요. 되돌릴 수 없어요.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              취소
            </Button>
            <Button
              variant="destructive"
              loading={lifecycle.isPending}
              onClick={() => lifecycle.mutate('delete')}
            >
              삭제하기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function amountRule(event: PartnerEventDetail): string {
  if (event.mode === 'INSTANT') {
    return event.fixedAmount === null ? '-' : formatWon(event.fixedAmount);
  }
  if (event.minAmount === null || event.maxAmount === null) return '-';
  return formatAmountRule(event.minAmount, event.maxAmount);
}

function OverviewPanel({ event }: { event: PartnerEventDetail }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>일정</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y">
            <CardRow label="신청 시작" value={formatFullDateTimeKo(event.applyStartAt)} />
            <CardRow label="신청 마감" value={formatFullDateTimeKo(event.applyEndAt)} />
            {event.originalApplyEndAt && event.originalApplyEndAt !== event.applyEndAt ? (
              <CardRow label="원래 마감" value={formatFullDateTimeKo(event.originalApplyEndAt)} />
            ) : null}
            <CardRow
              label="순위 확정"
              value={formatFullDateTimeKo(event.rankingLockAt)}
            />
            <CardRow label="이용 시작" value={formatFullDateTimeKo(event.serviceStartAt)} />
            <CardRow label="이용 종료" value={formatFullDateTimeKo(event.serviceEndAt)} />
          </dl>
          <InfoNote className="mt-4">
            순위는 마감이 아니라 <strong className="text-foreground">예약금 입금 시간이 모두 지난 뒤</strong>에
            확정돼요. 마감 1분 전에 신청한 분도 입금 시간을 온전히 쓸 수 있어야 하니까요.
          </InfoNote>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>예약금</CardTitle>
        </CardHeader>
        <CardContent>
          {event.depositRequired ? (
            <dl className="divide-y">
              <CardRow
                label="계산 방식"
                value={
                  event.depositType === 'PERCENT'
                    ? `신청 금액의 ${(event.depositPercentBp ?? 0) / 100}%`
                    : formatWon(event.depositFixedAmount)
                }
              />
              <CardRow label="입금 시간" value={`${formatNumber(event.depositWindowMinutes)}분`} />
              <CardRow label="절사 단위" value={formatWon(event.depositRoundingUnit)} />
              <CardRow label="안내" value={event.depositRefundNote ?? '-'} />
            </dl>
          ) : (
            <p className="text-sm leading-relaxed text-muted-foreground">
              예약금을 받지 않는 이벤트예요. 신청하면 바로 유효해져요.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>자동 연장</CardTitle>
        </CardHeader>
        <CardContent>
          {event.softCloseEnabled ? (
            <dl className="divide-y">
              <CardRow
                label="감지 시간"
                value={`마감 ${formatNumber(event.softCloseWindowMinutes ?? 0)}분 전`}
              />
              <CardRow
                label="연장 폭"
                value={`${formatNumber(event.softCloseExtendMinutes ?? 0)}분`}
              />
              <CardRow label="최종 마감" value={formatFullDateTimeKo(event.softCloseHardEndAt)} />
              <CardRow
                label="지금까지 연장"
                value={`${formatNumber(event.softCloseExtensionCount)}회 / 최대 ${formatNumber(event.softCloseMaxExtensions)}회`}
              />
            </dl>
          ) : (
            <p className="text-sm leading-relaxed text-muted-foreground">
              자동 연장을 쓰지 않아요. 마감 시각에 그대로 닫혀요.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>공개 정보</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y">
            <CardRow
              label="경쟁률"
              value={event.showCompetitionRatio ? '공개' : '비공개'}
            />
            <CardRow
              label="경쟁률 표시 최소 인원"
              value={`${formatNumber(event.ratioMinApplicantsToShow)}명`}
            />
            <CardRow label="현재 경쟁률" value={competitionText(event)} />
          </dl>
          <InfoNote className="mt-4">
            신청 기간에 이용자가 볼 수 있는 건 경쟁률뿐이에요. 다른 사람의 금액, 개인 순위,
            커트라인은 어디에도 나가지 않아요. 여기 보이는 숫자는 이벤트 주인인 파트너에게만 보여요.
          </InfoNote>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>소개글</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
            {event.description ?? '작성된 소개글이 없어요.'}
          </p>
          {event.tags.length > 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              {event.tags.map((tag) => `#${tag}`).join(' ')}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function competitionText(event: PartnerEventDetail): string {
  if (event.competitionRatioX10 === null) return '집계 전';
  return `${(event.competitionRatioX10 / 10).toFixed(1)}:1`;
}

/** 예약금 상태 라벨은 신청 현황 화면과 공유한다. 여기서 다시 만들지 않는다. */
export { DEPOSIT_STATUS_LABEL };
