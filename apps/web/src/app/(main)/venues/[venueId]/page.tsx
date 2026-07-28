import type { Metadata } from 'next';

import { VenueDetail } from './venue-detail';

export const metadata: Metadata = {
  title: '시설 상세',
};

export default async function VenueDetailPage({
  params,
}: {
  params: Promise<{ venueId: string }>;
}) {
  const { venueId } = await params;

  return <VenueDetail venueId={venueId} />;
}
