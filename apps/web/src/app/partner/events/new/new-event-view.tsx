'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';

import { PartnerShell } from '@/components/layout';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonList } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { VENUE_STATUS_LABEL, labelOf } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { createEvent, listCategories, listVenues } from '../../_lib/api';
import { EventForm, type EventFormValues } from '../../_components/event-form';
import { InfoNote, PartnerPageHeader } from '../../_components/partner-page';

export function NewEventView() {
  return (
    <PartnerShell>
      <NewEventBody />
    </PartnerShell>
  );
}

function NewEventBody() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { success } = useToast();

  const venues = useQuery({
    queryKey: qk.partner.venues.list({ limit: 100 }),
    queryFn: () => listVenues({ limit: 100 }),
    staleTime: 60_000,
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

  const create = useMutation({
    mutationFn: (values: EventFormValues) => createEvent(values),
    onSuccess: async (event) => {
      await queryClient.invalidateQueries({ queryKey: qk.partner.events.all });
      success('이벤트를 만들었어요', '아직 작성 중이에요. 공개하기를 누르면 이용자에게 보여요.');
      router.push(`/partner/events/${event.id}`);
    },
  });

  if (venues.isLoading) return <SkeletonList count={3} />;

  const items = venues.data?.items ?? [];

  if (items.length === 0) {
    return (
      <>
        <PartnerPageHeader title="이벤트 만들기" back={{ href: '/partner/events', label: '이벤트' }} />
        <EmptyState
          title="먼저 시설을 만들어 주세요"
          description="이벤트는 시설에서 열려요."
          action={
            <Link href="/partner/venues/new" className={buttonVariants({ variant: 'primary' })}>
              시설 만들기
            </Link>
          }
        />
      </>
    );
  }

  // 작성 중·검수 중 시설로도 초안은 만들 수 있다. 다만 공개(publish) 는 노출 중일 때만
  // 통과하므로, 라벨에 상태를 적어 나중에 막히는 이유를 미리 알려 준다.
  const venueOptions = items.map((venue) => ({
    value: venue.id,
    label:
      venue.status === 'ACTIVE'
        ? venue.name
        : `${venue.name} (${labelOf(VENUE_STATUS_LABEL, venue.status)})`,
  }));

  const hasActive = items.some((venue) => venue.status === 'ACTIVE');

  return (
    <div className="mx-auto max-w-3xl">
      <PartnerPageHeader
        title="이벤트 만들기"
        description="만들면 먼저 작성 중(DRAFT)으로 저장돼요. 내용을 확인한 뒤 공개하면 이용자가 신청할 수 있어요."
        back={{ href: '/partner/events', label: '이벤트' }}
      />

      {!hasActive ? (
        <InfoNote className="mb-4" title="노출 중인 시설이 없어요">
          초안은 만들 수 있지만, 시설이 검수를 통과해야 이벤트를 공개할 수 있어요.
        </InfoNote>
      ) : null}

      <Card>
        <CardContent className="p-4 md:p-6">
          <EventForm
            mode="create"
            venueOptions={venueOptions}
            categoryOptions={categoryOptions}
            submitLabel="이벤트 만들기"
            submitting={create.isPending}
            error={create.error}
            onSubmit={(values) => create.mutate(values)}
            onCancel={() => router.push('/partner/events')}
          />
        </CardContent>
      </Card>
    </div>
  );
}
