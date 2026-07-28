import type { Metadata } from 'next';

import { BusinessDetailView } from './business-detail-view';

export const metadata: Metadata = {
  title: '사업자 상세 · Dibs 파트너',
};

/** Next 15 에서 params 는 Promise 다. 서버 컴포넌트에서 풀어 클라이언트로 넘긴다. */
export default async function BusinessDetailPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  return <BusinessDetailView businessId={businessId} />;
}
