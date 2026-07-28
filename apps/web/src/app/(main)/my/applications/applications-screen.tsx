'use client';

import { Ticket } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { AppShell, TopBar } from '@/components/layout';
import {
  EmptyState,
  ErrorState,
  SkeletonList,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  buttonVariants,
} from '@/components/ui';
import { cn } from '@/lib/utils';
import { useRequireAuth } from '@/providers/auth-provider';
import type { ApplicationStatus } from '@/types/api';

import { ApplicationCard } from '../../_components/application-card';
import { InfiniteSentinel } from '../../_components/infinite-sentinel';
import { useMyApplications } from '../../_lib/queries';

/**
 * 내 신청 내역.
 *
 * ★ D-07 — 카드에 보이는 금액은 **내가 적어낸 금액**뿐이고 순위는 어디에도 없다.
 *   "현재 3위" 같은 줄을 넣고 싶어지면 DECISIONS.md D-07 을 다시 읽을 것.
 *
 * 상태 탭을 나눈 이유: 지금 손을 써야 하는 건(입금 대기)과 기다리면 되는 건이
 * 한 목록에 섞이면 예약금 타이머를 놓친다.
 */

const TABS: { value: string; label: string; status?: ApplicationStatus }[] = [
  { value: 'all', label: '전체' },
  { value: 'pending', label: '입금 대기', status: 'PENDING_DEPOSIT' },
  { value: 'valid', label: '진행 중', status: 'VALID' },
  { value: 'confirmed', label: '당첨', status: 'CONFIRMED' },
  { value: 'closed', label: '미당첨', status: 'NOT_SELECTED' },
];

export function ApplicationsScreen() {
  const { isReady } = useRequireAuth();
  const [tab, setTab] = useState('all');

  const status = TABS.find((item) => item.value === tab)?.status;
  const query = useMyApplications(status, isReady);

  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <AppShell header={<TopBar title="내 신청" />}>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList scrollable className="-mx-4 px-4">
          {TABS.map((item) => (
            <TabsTrigger key={item.value} value={item.value}>
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {TABS.map((item) => (
          <TabsContent key={item.value} value={item.value} className="pt-4">
            {!isReady || query.isPending ? (
              <SkeletonList count={4} />
            ) : query.isError ? (
              <ErrorState onRetry={() => void query.refetch()} />
            ) : items.length === 0 ? (
              <EmptyState
                icon={<Ticket className="h-6 w-6" aria-hidden="true" />}
                title={
                  item.status === undefined
                    ? '아직 신청한 예약이 없어요'
                    : `${item.label} 상태인 신청이 없어요`
                }
                description={
                  item.status === undefined
                    ? '마음에 드는 곳을 찾아 먼저 찜해 보세요.'
                    : '다른 탭에서 확인해 보세요.'
                }
                action={
                  item.status === undefined ? (
                    <Link href="/search" className={cn(buttonVariants({ size: 'md' }))}>
                      예약 찾아보기
                    </Link>
                  ) : undefined
                }
              />
            ) : (
              <>
                <ul className="space-y-3">
                  {items.map((application) => (
                    <li key={application.id}>
                      <ApplicationCard
                        application={application}
                        onChanged={() => void query.refetch()}
                      />
                    </li>
                  ))}
                </ul>
                <InfiniteSentinel
                  hasNextPage={query.hasNextPage}
                  isFetchingNextPage={query.isFetchingNextPage}
                  onLoadMore={() => void query.fetchNextPage()}
                  endMessage="신청 내역을 모두 봤어요"
                />
              </>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </AppShell>
  );
}
