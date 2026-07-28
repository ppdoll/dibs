import type { Metadata } from 'next';

import { EventDetailView } from './event-detail-view';

export const metadata: Metadata = {
  title: '이벤트 상세 · Dibs 파트너',
};

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  return <EventDetailView eventId={eventId} />;
}
