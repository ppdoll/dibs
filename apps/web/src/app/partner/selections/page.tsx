import type { Metadata } from 'next';
import { Suspense } from 'react';

import { SkeletonList } from '@/components/ui/skeleton';
import { SelectionsListView } from './selections-list-view';

export const metadata: Metadata = {
  title: '당첨자 발표 · Dibs 파트너',
};

/**
 * 발표가 필요한 이벤트를 한 곳에 모은다.
 *
 * 확정 화면은 이벤트별(/partner/events/[eventId]/selection)로 흩어져 있어서,
 * "지금 내가 발표해야 할 게 뭐가 남았지"를 보려면 이벤트 목록을 훑어야 했다.
 * 사이드바와 대시보드가 이미 이 주소를 가리키고 있었는데 페이지가 없어 404 였다.
 */
export default function PartnerSelectionsPage() {
  return (
    <Suspense fallback={<SkeletonList count={3} className="p-4 md:p-6" />}>
      <SelectionsListView />
    </Suspense>
  );
}
