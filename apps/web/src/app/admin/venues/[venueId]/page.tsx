import { VenueDetail } from './venue-detail';

export default async function Page({ params }: { params: Promise<{ venueId: string }> }) {
  const { venueId } = await params;
  return <VenueDetail venueId={venueId} />;
}
