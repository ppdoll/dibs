import type { Metadata } from 'next';

import { DashboardView } from './dashboard-view';

export const metadata: Metadata = {
  title: '파트너 대시보드 · Dibs',
};

/**
 * 파트너 콘솔 첫 화면.
 *
 * 승인 전 파트너도 들어올 수 있게 `allowUnapproved` 로 연다 — 심사 상태와 반려 사유를
 * 볼 수 있는 곳이 여기 말고 없으면, 승인이 안 난 파트너에게 콘솔은 그냥 잠긴 문이 된다.
 */
export default function PartnerDashboardPage() {
  return <DashboardView />;
}
