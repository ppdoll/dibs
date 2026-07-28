import type { Metadata } from 'next';

import { ProfileView } from './profile-view';

export const metadata: Metadata = {
  title: '파트너 정보 · Dibs',
};

export default function PartnerProfilePage() {
  return <ProfileView />;
}
