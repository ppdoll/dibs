'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { PartnerShell } from '@/components/layout';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonList } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { qk } from '@/lib/query-keys';
import { createVenue, listBusinesses } from '../../_lib/api';
import { BUSINESS_VERIFICATION_LABEL } from '../../_lib/labels';
import { VenueForm, type VenueFormValues } from '../../_components/venue-form';
import { InfoNote, PartnerPageHeader } from '../../_components/partner-page';

export function NewVenueView() {
  return (
    <PartnerShell>
      <NewVenueBody />
    </PartnerShell>
  );
}

function NewVenueBody() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { success } = useToast();

  const businesses = useQuery({
    queryKey: qk.partner.businesses.list,
    queryFn: listBusinesses,
    staleTime: 30_000,
  });

  const create = useMutation({
    mutationFn: (values: VenueFormValues) => createVenue(values),
    onSuccess: async (venue) => {
      await queryClient.invalidateQueries({ queryKey: qk.partner.venues.all });
      await queryClient.invalidateQueries({ queryKey: qk.partner.profile });
      success('시설을 만들었어요', '사진을 올린 뒤 검수를 요청할 수 있어요.');
      router.push(`/partner/venues/${venue.id}/images`);
    },
  });

  if (businesses.isLoading) return <SkeletonList count={3} />;

  const list = businesses.data ?? [];

  if (list.length === 0) {
    return (
      <>
        <PartnerPageHeader title="시설 만들기" back={{ href: '/partner/venues', label: '내 시설' }} />
        <EmptyState
          title="먼저 사업자를 등록해 주세요"
          description="시설은 사업자 아래에서 만들어져요."
          action={
            <Link href="/partner/businesses/new" className={buttonVariants({ variant: 'primary' })}>
              사업자 등록하기
            </Link>
          }
        />
      </>
    );
  }

  // 확인이 끝나지 않은 사업자도 목록에는 보여준다. 고르지 못하게만 하고 왜 못 고르는지
  // 라벨에 적어 둔다 — 선택지가 사라지면 "내 사업자가 왜 없지?" 로 헤매게 된다.
  const options = list.map((business) => ({
    value: business.id,
    label:
      business.verificationStatus === 'VERIFIED'
        ? business.name
        : `${business.name} (${BUSINESS_VERIFICATION_LABEL[business.verificationStatus]})`,
    disabled: business.verificationStatus !== 'VERIFIED',
  }));

  const hasVerified = list.some((business) => business.verificationStatus === 'VERIFIED');

  return (
    <div className="mx-auto max-w-3xl">
      <PartnerPageHeader
        title="시설 만들기"
        description="먼저 작성 중(DRAFT) 상태로 저장돼요. 사진을 올리고 검수를 요청하면 공개 준비가 끝나요."
        back={{ href: '/partner/venues', label: '내 시설' }}
      />

      {!hasVerified ? (
        <InfoNote className="mb-4" title="사업자 확인이 아직이에요">
          시설을 만들 수는 있지만, 사업자등록증 확인이 끝나야 검수를 요청할 수 있어요.
        </InfoNote>
      ) : null}

      <Card>
        <CardContent className="p-4 md:p-6">
          <VenueForm
            mode="create"
            businessOptions={options}
            submitLabel="시설 만들기"
            submitting={create.isPending}
            error={create.error}
            onSubmit={(values) => create.mutate(values)}
            onCancel={() => router.push('/partner/venues')}
          />
        </CardContent>
      </Card>
    </div>
  );
}
