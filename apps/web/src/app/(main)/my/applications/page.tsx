import type { Metadata } from 'next';

import { ApplicationsScreen } from './applications-screen';

export const metadata: Metadata = {
  title: '내 신청',
  description: '신청한 예약의 상태와 예약금 결제 기한을 확인하세요.',
};

export default function MyApplicationsPage() {
  return <ApplicationsScreen />;
}
