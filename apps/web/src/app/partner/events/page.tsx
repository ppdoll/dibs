import type { Metadata } from 'next';
import { Suspense } from 'react';

import { SkeletonList } from '@/components/ui/skeleton';
import { EventListView } from './event-list-view';

export const metadata: Metadata = {
  title: '이벤트 · Dibs 파트너',
};

/**
 * useSearchParams 를 쓰는 클라이언트 화면은 Suspense 경계가 있어야 한다.
 * 없으면 빌드가 페이지 전체를 동적 렌더링으로 떨어뜨린다.
 */
export default function PartnerEventsPage() {
  return (
    <Suspense fallback={<SkeletonList count={3} className="p-4 md:p-6" />}>
      <EventListView />
    </Suspense>
  );
}
