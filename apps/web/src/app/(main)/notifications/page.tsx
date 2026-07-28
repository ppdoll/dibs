import type { Metadata } from 'next';

import { NotificationsScreen } from './notifications-screen';

export const metadata: Metadata = {
  title: '알림',
  description: '신청 결과와 예약금 안내, 주최 측 쪽지를 확인하세요.',
};

export default function NotificationsPage() {
  return <NotificationsScreen />;
}
