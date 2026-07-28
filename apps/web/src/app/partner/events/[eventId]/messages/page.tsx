import type { Metadata } from 'next';

import { EventMessagesView } from './messages-view';

export const metadata: Metadata = {
  title: '신청자에게 쪽지 · Dibs 파트너',
};

export default async function EventMessagesPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  return <EventMessagesView eventId={eventId} />;
}
