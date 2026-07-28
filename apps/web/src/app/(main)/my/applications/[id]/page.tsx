import type { Metadata } from 'next';

import { ApplicationDetail } from './application-detail';

export const metadata: Metadata = {
  title: '신청 상세',
};

export default async function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <ApplicationDetail applicationId={id} />;
}
