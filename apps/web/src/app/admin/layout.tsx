import type { Metadata } from 'next';

import { AdminShell } from '@/components/layout';

/**
 * 운영자 콘솔 레이아웃.
 *
 * 권한 검사는 `AdminShell` 안에 이미 들어 있다(운영자가 아니면 안내만 보여준다).
 * 여기서 한 번 더 막지 않는 이유는 검사가 두 곳이면 한쪽만 고쳐지기 때문이다.
 *
 * 진짜 방어선은 서버다 — 모든 `/api/admin/*` 이 ADMIN 역할을 요구하므로,
 * 이 화면을 강제로 열어도 데이터는 한 줄도 오지 않는다. 프론트의 게이트는
 * "잘못 들어온 사람에게 설명해 주는" 용도다.
 */
export const metadata: Metadata = {
  title: '운영자 콘솔 · Dibs',
  // 콘솔 화면이 검색엔진에 잡히면 안 된다.
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
