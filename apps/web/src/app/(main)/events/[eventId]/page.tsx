import type { Metadata } from 'next';

import { EventDetail } from './event-detail';

export const metadata: Metadata = {
  title: '예약 상세',
};

/**
 * 이벤트 상세.
 *
 * Next 15 부터 `params` 는 Promise 라 await 해야 한다. 값 자체는 id 또는 slug 이고,
 * 서버가 둘 다 받아 주므로(`GET /api/events/:key`) 여기서 구분하지 않는다.
 */
export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;

  return <EventDetail eventKey={eventId} />;
}
