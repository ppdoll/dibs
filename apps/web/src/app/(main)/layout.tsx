/**
 * 이용자 화면 묶음.
 *
 * 껍데기(AppShell)는 화면마다 다르다 — 홈은 탭바, 상세는 하단 CTA 라서
 * 레이아웃에서 한 번에 씌울 수가 없다. 그래서 여기서는 아무것도 감싸지 않고
 * 라우트 그룹으로 묶기만 한다. 프로바이더는 루트 레이아웃에 이미 올라가 있다.
 */
export default function MainLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
