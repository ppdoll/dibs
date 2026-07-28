import type { Metadata } from 'next';

import { BusinessListView } from './business-list-view';

export const metadata: Metadata = {
  title: '사업자 정보 · Dibs 파트너',
};

export default function PartnerBusinessesPage() {
  return <BusinessListView />;
}
