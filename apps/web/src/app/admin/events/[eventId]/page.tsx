import { EventOpsDetail } from './event-detail';

export default async function Page({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  return <EventOpsDetail eventId={eventId} />;
}
