import type { Metadata } from 'next';

import { ApplicantsView } from './applicants-view';

export const metadata: Metadata = {
  title: '신청 현황 · Dibs 파트너',
};

export default async function ApplicantsPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  return <ApplicantsView eventId={eventId} />;
}
