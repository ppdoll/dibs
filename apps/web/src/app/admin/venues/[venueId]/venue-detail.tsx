'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ImageOff, ShieldAlert } from 'lucide-react';

import { Badge, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { apiGet, toUserMessage } from '@/lib/api-client';
import { labelOf } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { cn } from '@/lib/utils';

import {
  AdminPage,
  CopyableId,
  KeyValue,
  KeyValueGrid,
  Maybe,
  Notice,
  Panel,
  TimeCell,
} from '../../_components/console';
import { VenueActions, VenueImageActions } from '../../_components/venue-actions';
import {
  BUSINESS_STATUS_LABEL,
  BUSINESS_STATUS_TONE,
  VENUE_IMAGE_STATUS_LABEL,
  VENUE_STATUS_LABEL,
  VENUE_STATUS_TONE,
} from '../../_lib/labels';
import type { AdminVenueDetail, AdminVenueImage } from '../../_lib/types';

/**
 * 시설 상세 · 검수 화면.
 *
 * 검수의 실질은 "사진과 주소가 실제 매장과 맞는가" 하나다. 그래서 사진을 크게 깔고
 * 주소·연락처를 그 옆에 붙인다. 정보를 표로만 나열하면 사진을 안 보고 승인하게 된다.
 */
export function VenueDetail({ venueId }: { venueId: string }) {
  const query = useQuery({
    queryKey: qk.admin.venueDetail(venueId),
    queryFn: () => apiGet<AdminVenueDetail>(`/api/admin/venues/${venueId}`),
  });

  if (query.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <ErrorState
        title="시설을 불러오지 못했어요"
        description={toUserMessage(query.error)}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const venue = query.data;
  const quarantined = venue.images.filter((image) => image.status === 'QUARANTINED');
  const businessBlocked = venue.business && venue.business.verificationStatus !== 'VERIFIED';

  return (
    <AdminPage
      back={{ href: '/admin/venues', label: '시설 검수 큐' }}
      title={venue.name}
      description={venue.summary ?? venue.roadAddress ?? undefined}
      actions={
        <Badge variant={VENUE_STATUS_TONE[venue.status] ?? 'muted'}>
          {labelOf(VENUE_STATUS_LABEL, venue.status)}
        </Badge>
      }
    >
      {venue.status === 'SUSPENDED' && venue.suspensionReason ? (
        <Notice tone="danger" title="정지 중">
          {venue.suspensionReason}
        </Notice>
      ) : null}

      {businessBlocked ? (
        <Notice tone="warning" title="사업자 확인이 끝나지 않았습니다">
          연결된 사업자가{' '}
          <strong>{labelOf(BUSINESS_STATUS_LABEL, venue.business?.verificationStatus)}</strong>{' '}
          상태입니다. 이 상태로는 검수 승인이 서버에서 막힙니다.{' '}
          {venue.business ? (
            <Link
              href={`/admin/businesses/${venue.business.id}`}
              className="font-semibold underline"
            >
              사업자 확인하러 가기
            </Link>
          ) : null}
        </Notice>
      ) : null}

      {quarantined.length > 0 ? (
        <Notice tone="warning" title={`격리된 이미지 ${quarantined.length}장`}>
          격리된 사진은 이용자에게 보이지 않습니다. 아래 사진 목록에서 해제할 수 있어요.
        </Notice>
      ) : null}

      <Panel title="조치">
        <VenueActions
          venueId={venue.id}
          status={venue.status}
          onDone={() => void query.refetch()}
        />
      </Panel>

      <Panel
        title={`사진 ${venue.images.length}장`}
        description="대표 이미지를 격리하면 대표 지정도 함께 풀립니다."
        bodyClassName={venue.images.length === 0 ? 'p-0' : 'p-4'}
      >
        {venue.images.length === 0 ? (
          <EmptyState
            compact
            icon={<ImageOff className="h-6 w-6" aria-hidden="true" />}
            title="등록된 사진이 없어요"
            description="사진이 하나도 없는 시설은 검색 결과에서 거의 눌리지 않습니다. 승인 전에 파트너에게 요청하는 편이 좋아요."
          />
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {venue.images.map((image) => (
              <VenueImageCard
                key={image.id}
                venueId={venue.id}
                image={image}
                onDone={() => void query.refetch()}
              />
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="시설 정보">
        <KeyValueGrid>
          <KeyValue label="시설명">{venue.name}</KeyValue>
          <KeyValue label="슬러그">
            <code className="font-mono text-xs">{venue.slug}</code>
          </KeyValue>
          <KeyValue label="지역">
            {[venue.sido, venue.sigungu].filter(Boolean).join(' ') || '-'}
          </KeyValue>
          <KeyValue label="좌석 수">
            <Maybe value={venue.seatCount} />
          </KeyValue>
          <KeyValue label="주소" full>
            <Maybe value={venue.roadAddress} />
            {venue.detailAddress ? (
              <span className="text-muted-foreground"> {venue.detailAddress}</span>
            ) : null}
            {venue.postalCode ? (
              <span className="ml-2 text-xs text-muted-foreground">({venue.postalCode})</span>
            ) : null}
          </KeyValue>
          <KeyValue label="연락처">
            <Maybe value={venue.phone} />
          </KeyValue>
          <KeyValue label="웹사이트">
            {venue.websiteUrl ? (
              // 외부 링크는 새 탭 + noreferrer. 운영자 콘솔의 referrer 가 외부로 새면 안 된다.
              <a
                href={venue.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all text-primary hover:underline"
              >
                {venue.websiteUrl}
              </a>
            ) : (
              <Maybe value={null} />
            )}
          </KeyValue>
          <KeyValue label="인스타그램">
            <Maybe value={venue.instagramHandle} />
          </KeyValue>
          <KeyValue label="소개" full>
            {venue.description ? (
              <p className="whitespace-pre-line leading-relaxed">{venue.description}</p>
            ) : (
              <Maybe value={null} />
            )}
          </KeyValue>
          <KeyValue label="예약 안내" full>
            {venue.reservationNotice ? (
              <p className="whitespace-pre-line leading-relaxed">{venue.reservationNotice}</p>
            ) : (
              <Maybe value={null} />
            )}
          </KeyValue>
        </KeyValueGrid>
      </Panel>

      <Panel title="상태 이력">
        <KeyValueGrid>
          <KeyValue label="검수 요청">
            <TimeCell value={venue.submittedForReviewAt} />
          </KeyValue>
          <KeyValue label="최초 공개">
            <TimeCell value={venue.publishedAt} />
          </KeyValue>
          <KeyValue label="비공개 전환">
            <TimeCell value={venue.hiddenAt} />
          </KeyValue>
          <KeyValue label="정지">
            <TimeCell value={venue.suspendedAt} />
          </KeyValue>
          <KeyValue label="진행 중 이벤트">{venue.openEventCount}개</KeyValue>
          <KeyValue label="시설 ID">
            <CopyableId value={venue.id} />
          </KeyValue>
        </KeyValueGrid>
        <p className="mt-2 text-xs text-muted-foreground">
          <Link
            href={`/admin/audit-logs?targetType=VENUE&targetId=${venue.id}`}
            className="font-semibold text-primary hover:underline"
          >
            이 시설의 감사 로그 보기
          </Link>
        </p>
      </Panel>

      {venue.business ? (
        <Panel title="사업자 · 파트너">
          <KeyValueGrid>
            <KeyValue label="사업자">
              <Link
                href={`/admin/businesses/${venue.business.id}`}
                className="font-semibold hover:underline"
              >
                {venue.business.name}
              </Link>
            </KeyValue>
            <KeyValue label="사업자 확인">
              <Badge variant={BUSINESS_STATUS_TONE[venue.business.verificationStatus] ?? 'muted'}>
                {labelOf(BUSINESS_STATUS_LABEL, venue.business.verificationStatus)}
              </Badge>
            </KeyValue>
            <KeyValue label="파트너">
              <Link
                href={`/admin/partners/${venue.business.partner.id}`}
                className="font-semibold hover:underline"
              >
                {venue.business.partner.contactName}
              </Link>
            </KeyValue>
          </KeyValueGrid>
        </Panel>
      ) : (
        <Panel title="사업자 · 파트너">
          <p className="text-sm text-muted-foreground">
            연결된 사업자가 없습니다. 사업자 없이는 검수를 통과할 수 없어요.
          </p>
        </Panel>
      )}
    </AdminPage>
  );
}

function VenueImageCard({
  venueId,
  image,
  onDone,
}: {
  venueId: string;
  image: AdminVenueImage;
  onDone: () => void;
}) {
  const quarantined = image.status === 'QUARANTINED';

  return (
    <li className="overflow-hidden rounded-lg border">
      <div className="relative aspect-[4/3] bg-muted">
        {/*
          next/image 를 쓰지 않는다: 원격 이미지 도메인 설정(next.config)이 이 화면 담당의
          권한 밖이고, 검수용 미리보기라 최적화보다 "지금 올라와 있는 그대로" 보이는 게 중요하다.
        */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.blobUrl}
          alt={image.altText ?? '시설 사진'}
          loading="lazy"
          className={cn(
            'h-full w-full object-cover',
            // 격리된 사진은 흐리게. 지운 게 아니라 "가려 둔 것"임을 그대로 보여준다.
            quarantined && 'opacity-40 blur-[2px]',
          )}
        />

        <div className="absolute left-2 top-2 flex flex-wrap gap-1">
          {image.isCover ? <Badge variant="overlay">대표</Badge> : null}
          {quarantined ? (
            <Badge variant="destructive">
              <ShieldAlert className="h-3 w-3" aria-hidden="true" />
              격리됨
            </Badge>
          ) : image.status !== 'READY' ? (
            <Badge variant="overlay">{labelOf(VENUE_IMAGE_STATUS_LABEL, image.status)}</Badge>
          ) : null}
        </div>
      </div>

      <div className="space-y-2 p-2.5">
        <p className="line-clamp-2 min-h-[2rem] text-xs text-muted-foreground">
          {image.altText ?? '대체 텍스트 없음'}
        </p>

        {quarantined && image.quarantineReason ? (
          <p className="rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">
            {image.quarantineReason}
          </p>
        ) : null}

        <VenueImageActions
          venueId={venueId}
          imageId={image.id}
          quarantined={quarantined}
          onDone={onDone}
        />
      </div>
    </li>
  );
}
