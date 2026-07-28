/**
 * React Query 키를 한 곳에 모은다.
 *
 * 키를 화면마다 손으로 적으면 무효화가 어긋난다. 신청을 하나 넣었을 때
 * 목록·상세·알림 배지가 같이 갱신되어야 하는데, 문자열이 한 글자만 달라도
 * 조용히 안 된다. 접두사를 공유하는 배열로 만들어 두면
 * `invalidateQueries({ queryKey: qk.applications.all })` 한 줄로 하위가 전부 걸린다.
 */

export const qk = {
  auth: {
    me: ['auth', 'me'] as const,
  },

  discovery: {
    home: ['discovery', 'home'] as const,
  },

  catalog: {
    categories: ['catalog', 'categories'] as const,
    regions: ['catalog', 'regions'] as const,
  },

  events: {
    all: ['events'] as const,
    list: (params: unknown) => ['events', 'list', params] as const,
    detail: (key: string) => ['events', 'detail', key] as const,
  },

  search: {
    events: (params: unknown) => ['search', 'events', params] as const,
    venues: (params: unknown) => ['search', 'venues', params] as const,
  },

  applications: {
    all: ['applications'] as const,
    list: (params: unknown) => ['applications', 'list', params] as const,
    detail: (id: string) => ['applications', 'detail', id] as const,
  },

  notifications: {
    all: ['notifications'] as const,
    list: (params: unknown) => ['notifications', 'list', params] as const,
    unreadCount: ['notifications', 'unread-count'] as const,
    preferences: ['notifications', 'preferences'] as const,
  },

  messages: {
    all: ['messages'] as const,
    list: (params: unknown) => ['messages', 'list', params] as const,
    detail: (id: string) => ['messages', 'detail', id] as const,
  },

  partner: {
    all: ['partner'] as const,
    profile: ['partner', 'profile'] as const,
    events: {
      all: ['partner', 'events'] as const,
      list: (params: unknown) => ['partner', 'events', 'list', params] as const,
      detail: (id: string) => ['partner', 'events', 'detail', id] as const,
      images: (id: string) => ['partner', 'events', id, 'images'] as const,
    },
    venues: {
      all: ['partner', 'venues'] as const,
      list: (params: unknown) => ['partner', 'venues', 'list', params] as const,
      detail: (id: string) => ['partner', 'venues', 'detail', id] as const,
      images: (id: string) => ['partner', 'venues', id, 'images'] as const,
    },
    businesses: {
      all: ['partner', 'businesses'] as const,
      list: ['partner', 'businesses', 'list'] as const,
      detail: (id: string) => ['partner', 'businesses', 'detail', id] as const,
    },
    selections: {
      all: ['partner', 'selections'] as const,
      byEvent: (eventId: string) => ['partner', 'selections', 'by-event', eventId] as const,
      detail: (selectionId: string) => ['partner', 'selections', selectionId] as const,
      entries: (selectionId: string, params?: unknown) =>
        ['partner', 'selections', selectionId, 'entries', params ?? null] as const,
    },
  },

  admin: {
    all: ['admin'] as const,
    dashboard: ['admin', 'dashboard'] as const,
    expiringHolds: ['admin', 'dashboard', 'expiring-holds'] as const,
    overduePartners: ['admin', 'dashboard', 'overdue-partners'] as const,
    partners: (params: unknown) => ['admin', 'partners', params] as const,
    partnerDetail: (id: string) => ['admin', 'partners', 'detail', id] as const,
    venues: (params: unknown) => ['admin', 'venues', params] as const,
    venueDetail: (id: string) => ['admin', 'venues', 'detail', id] as const,
    businesses: (params: unknown) => ['admin', 'businesses', params] as const,
    users: (params: unknown) => ['admin', 'users', params] as const,
    userDetail: (id: string) => ['admin', 'users', 'detail', id] as const,
    events: (params: unknown) => ['admin', 'events', params] as const,
    eventDetail: (id: string) => ['admin', 'events', 'detail', id] as const,
    auditLogs: (params: unknown) => ['admin', 'audit-logs', params] as const,
    settings: ['admin', 'settings'] as const,
    broadcasts: (params: unknown) => ['admin', 'broadcasts', params] as const,
    broadcastDetail: (id: string) => ['admin', 'broadcasts', 'detail', id] as const,
    selectionByEvent: (eventId: string) => ['admin', 'selections', 'by-event', eventId] as const,
  },
} as const;
