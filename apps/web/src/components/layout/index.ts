/**
 * 앱 셸. 화면 코드는 여기서 필요한 껍데기를 골라 쓴다.
 *
 *   이용자 화면 → AppShell (+ TopBar / StickyBottomBar)
 *   파트너 화면 → PartnerShell
 *   운영자 화면 → AdminShell
 */

export { AppShell, StickyBottomBar, PageHeader, SectionHeader } from './app-shell';
export { TopBar, HomeTopBar, NotificationBellLink } from './top-bar';
export { BottomTabBar, BottomTabSpacer } from './bottom-tab-bar';
export { ConsoleShell, type ConsoleNavItem, type ConsoleNavGroup } from './console-shell';
export { PartnerShell } from './partner-shell';
export { AdminShell } from './admin-shell';
export { AccountMenu } from './account-menu';
export { RoleGate, type GateRole } from './role-gate';
export { useUnreadCount } from './use-unread-count';
