import type { Metadata } from 'next';

import { NewVenueView } from './new-venue-view';

export const metadata: Metadata = {
  title: '시설 만들기 · Dibs 파트너',
};

export default function NewVenuePage() {
  return <NewVenueView />;
}
