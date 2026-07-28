'use client';

import { useQuery } from '@tanstack/react-query';
import { Building2, Plus } from 'lucide-react';
import Link from 'next/link';

import { PartnerShell } from '@/components/layout';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { SkeletonList } from '@/components/ui/skeleton';
import { formatNumber } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { listBusinesses } from '../_lib/api';
import { BUSINESS_TYPE_LABEL } from '../_lib/labels';
import { BusinessStatusBadge, InfoNote, PartnerPageHeader } from '../_components/partner-page';
import { toPartnerMessage } from '../_lib/errors';

/** 하이픈 없는 10자리를 사람이 읽는 모양으로. 서버는 정규화된 값을 돌려준다. */
function formatBrn(raw: string): string {
  if (raw.length !== 10) return raw;
  return `${raw.slice(0, 3)}-${raw.slice(3, 5)}-${raw.slice(5)}`;
}

export function BusinessListView() {
  return (
    <PartnerShell>
      <BusinessListBody />
    </PartnerShell>
  );
}

function BusinessListBody() {
  const businesses = useQuery({
    queryKey: qk.partner.businesses.list,
    queryFn: listBusinesses,
    staleTime: 30_000,
  });

  return (
    <>
      <PartnerPageHeader
        title="사업자 정보"
        description="시설은 사업자 아래에서 만들어져요. 사업자등록증 확인이 끝나야 시설을 검수에 올릴 수 있어요."
        actions={
          <Link href="/partner/businesses/new" className={buttonVariants({ variant: 'primary' })}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            사업자 등록
          </Link>
        }
      />

      {businesses.isLoading ? (
        <SkeletonList count={2} />
      ) : businesses.isError ? (
        <ErrorState
          title="사업자 목록을 불러오지 못했어요"
          description={toPartnerMessage(businesses.error)}
          onRetry={() => void businesses.refetch()}
        />
      ) : (businesses.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon={<Building2 className="h-6 w-6" aria-hidden="true" />}
          title="등록된 사업자가 없어요"
          description="사업자를 등록하고 사업자등록증을 올리면 운영자가 확인해 드려요."
          action={
            <Link href="/partner/businesses/new" className={buttonVariants({ variant: 'primary' })}>
              사업자 등록하기
            </Link>
          }
        />
      ) : (
        <ul className="space-y-3">
          {(businesses.data ?? []).map((business) => (
            <li key={business.id}>
              <Link href={`/partner/businesses/${business.id}`} className="block">
                <Card interactive>
                  <CardContent className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{business.name}</span>
                          <BusinessStatusBadge status={business.verificationStatus} />
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {business.legalName} · {BUSINESS_TYPE_LABEL[business.businessType]} ·{' '}
                          {formatBrn(business.businessRegistrationNumber)}
                        </p>
                      </div>

                      <div className="shrink-0 text-right text-sm text-muted-foreground">
                        <p>시설 {formatNumber(business.venueCount)}곳</p>
                        <p className={business.hasRegistrationDoc ? '' : 'text-destructive'}>
                          {business.hasRegistrationDoc ? '등록증 첨부됨' : '등록증 없음'}
                        </p>
                      </div>
                    </div>

                    {business.verificationRejectionReason ? (
                      <InfoNote className="mt-3" title="반려 사유">
                        {business.verificationRejectionReason}
                      </InfoNote>
                    ) : null}
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
