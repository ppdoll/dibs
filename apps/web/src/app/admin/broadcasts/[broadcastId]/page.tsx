import { BroadcastDetail } from './broadcast-detail';

export default async function Page({ params }: { params: Promise<{ broadcastId: string }> }) {
  const { broadcastId } = await params;
  return <BroadcastDetail broadcastId={broadcastId} />;
}
