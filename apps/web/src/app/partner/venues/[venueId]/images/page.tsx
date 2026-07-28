import type { Metadata } from 'next';

import { VenueImagesView } from './venue-images-view';

export const metadata: Metadata = {
  title: '시설 사진 관리 · Dibs 파트너',
};

export default async function VenueImagesPage({
  params,
}: {
  params: Promise<{ venueId: string }>;
}) {
  const { venueId } = await params;
  return <VenueImagesView venueId={venueId} />;
}
