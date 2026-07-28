import type { Metadata } from 'next';

import { VenueListView } from './venue-list-view';

export const metadata: Metadata = {
  title: '내 시설 · Dibs 파트너',
};

export default function PartnerVenuesPage() {
  return <VenueListView />;
}
