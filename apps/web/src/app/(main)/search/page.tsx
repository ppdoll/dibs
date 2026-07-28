import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AppShell, TopBar } from '@/components/layout';
import { SkeletonList } from '@/components/ui';

import { SearchScreen } from './search-screen';

export const metadata: Metadata = {
  title: '탐색',
  description: '지역·업종·금액으로 열려 있는 예약을 찾아보세요.',
};

/**
 * 검색 화면.
 *
 * Suspense 로 감싸는 이유: 검색 조건이 URL 에 있어서 화면이 `useSearchParams` 를 쓴다.
 * Next 15 는 그 훅을 쓰는 트리를 정적으로 미리 만들 수 없어서, 경계가 없으면
 * 빌드 자체가 실패한다. 경계 안쪽만 요청 시점에 그린다.
 */
export default function SearchPage() {
  return (
    <Suspense fallback={<SearchFallback />}>
      <SearchScreen />
    </Suspense>
  );
}

function SearchFallback() {
  return (
    <AppShell header={<TopBar showBack backHref="/" title="탐색" />}>
      <SkeletonList count={5} className="pt-4" />
    </AppShell>
  );
}
