import type { Metadata } from 'next';

import { ApplyView } from './apply-view';

export const metadata: Metadata = {
  title: '파트너 신청 · Dibs',
};

export default function PartnerApplyPage() {
  return <ApplyView />;
}
