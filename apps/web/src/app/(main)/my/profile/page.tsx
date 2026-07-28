import type { Metadata } from 'next';

import { ProfileScreen } from './profile-screen';

export const metadata: Metadata = {
  title: '내 정보 · 알림 설정',
};

export default function ProfilePage() {
  return <ProfileScreen />;
}
