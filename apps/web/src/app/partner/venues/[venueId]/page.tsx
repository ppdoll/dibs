import type { Metadata } from 'next';

import { VenueDetailView } from './venue-detail-view';

export const metadata: Metadata = {
  title: '시설 상세 · Dibs 파트너',
};

export default async function VenueDetailPage({
  params,
}: {
  params: Promise<{ venueId: string }>;
}) {
  const { venueId } = await params;
  return <VenueDetailView venueId={venueId} />;
}
