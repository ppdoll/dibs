'use client';

/**
 * 이용자 화면이 서버와 이야기하는 통로.
 *
 * 화면 컴포넌트가 apiGet 을 직접 부르지 않게 하려고 모아 뒀다. 이유는 두 가지다.
 *  1) 쿼리 키를 손으로 적으면 무효화가 어긋난다. 신청 하나가 성공했을 때
 *     목록·상세·경쟁률·알림 배지가 같이 갱신되어야 한다.
 *  2) 경로 오타를 한 곳에서만 낼 수 있다. 경로는 docs/API-ROUTES.md 와 글자까지 같다.
 *
 * ★ D-07 — 이 파일에는 순위·커트라인을 가져오는 요청이 없다. 그런 엔드포인트는
 *   이용자에게 열려 있지 않고, 있어도 부르지 않는다.
 */

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useCallback, useRef } from 'react';

import { apiGet, apiPostMutate, apiPut, newIdempotencyKey } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import type {
  Category,
  DiscoveryHome,
  EventSort,
  EventModeValue,
  MessagePage,
  MyApplicationDetail,
  MyApplicationPage,
  NotificationPage,
  NotificationPreferences,
  PartnerApplicationResult,
  PublicEventPage,
  PublicEventCard,
  PublicEventSummary,
  PublicVenueCard,
  PublicVenuePage,
  Region,
  SubmitPartnerApplicationBody,
  UpdateNotificationPreferencesBody,
  ApplicationStatus,
  UnreadCount,
} from '@/types/api';
import type {
  ApplyResult,
  CancelResult,
  DepositConfirmResult,
  RaiseResult,
} from './types';

/** 경쟁률은 초 단위로 변한다. 상세 화면에서만 이 주기로 다시 읽는다. (D-11 — SSE 는 아직 없다) */
export const COMPETITION_REFETCH_MS = 30_000;

// ─── 탐색 · 검색 ──────────────────────────────────────────────────────

export function useDiscoveryHome(sigunguCode?: string) {
  return useQuery({
    queryKey: [...qk.discovery.home, sigunguCode ?? 'ALL'],
    queryFn: ({ signal }) =>
      apiGet<DiscoveryHome>('/api/discovery/home', {
        withAuth: false,
        signal,
        query: { sigunguCode },
      }),
    staleTime: 60_000,
  });
}

export interface EventSearchParams {
  keyword?: string;
  sigunguCode?: string;
  categoryId?: string;
  mode?: EventModeValue;
  amountFrom?: number;
  amountTo?: number;
  deadlineWithinHours?: number;
  sort?: EventSort;
}

/** "마감임박" 칩이 서버에 보내는 기본값. 백엔드 DEADLINE_SOON_DEFAULT_HOURS 와 같다. */
export const DEADLINE_SOON_HOURS = 48;

export function useSearchEvents(params: EventSearchParams, enabled = true) {
  return useInfiniteQuery({
    queryKey: qk.search.events(params),
    queryFn: ({ pageParam, signal }) =>
      apiGet<PublicEventPage>('/api/search/events', {
        withAuth: false,
        signal,
        query: { ...params, limit: 20, cursor: pageParam },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
    staleTime: 30_000,
  });
}

export interface VenueSearchParams {
  keyword?: string;
  sigunguCode?: string;
  categoryId?: string;
  /** relevance | popular | newest | name */
  sort?: string;
}

export function useSearchVenues(params: VenueSearchParams, enabled = true) {
  return useInfiniteQuery({
    queryKey: qk.search.venues(params),
    queryFn: ({ pageParam, signal }) =>
      apiGet<PublicVenuePage>('/api/search/venues', {
        withAuth: false,
        signal,
        query: { ...params, limit: 20, cursor: pageParam },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
    staleTime: 60_000,
  });
}

// ─── 카탈로그 (필터 재료) ─────────────────────────────────────────────

export function useCategories() {
  return useQuery({
    queryKey: qk.catalog.categories,
    queryFn: ({ signal }) =>
      apiGet<Category[]>('/api/catalog/categories', { withAuth: false, signal }),
    // 업종 목록은 하루에 한 번 바뀔까 말까다. 필터 시트를 열 때마다 받아올 이유가 없다.
    staleTime: 30 * 60_000,
  });
}

export function useRegions(parentCode?: string) {
  return useQuery({
    queryKey: [...qk.catalog.regions, parentCode ?? 'SIDO'],
    queryFn: ({ signal }) =>
      apiGet<Region[]>('/api/catalog/regions', {
        withAuth: false,
        signal,
        query: parentCode ? { level: 'SIGUNGU', parentCode } : { level: 'SIDO' },
      }),
    staleTime: 30 * 60_000,
  });
}

// ─── 이벤트 상세 ──────────────────────────────────────────────────────

export function usePublicEvent(key: string) {
  return useQuery({
    queryKey: qk.events.detail(key),
    queryFn: ({ signal }) =>
      apiGet<PublicEventSummary>(`/api/events/${encodeURIComponent(key)}`, {
        withAuth: false,
        signal,
      }),
    // 마감 임박에는 경쟁률이 실시간에 가까워야 한다. 폴링 주기를 화면에서 명시한다.
    refetchInterval: COMPETITION_REFETCH_MS,
    staleTime: 10_000,
  });
}

/**
 * 상세 화면에 얹을 사진·시설·업종을 **검색 결과에서 빌려 온다**.
 *
 * GET /api/events/:key 는 D-07 화이트리스트 select 때문에 이미지·시설명·설명을
 * 아예 읽지 않는다. 그렇다고 상세 화면을 글자만으로 둘 수는 없어서, 같은 제목으로
 * 공개 검색을 한 번 더 때리고 id 가 일치하는 카드를 찾아 쓴다.
 *
 * 임시 다리다 — 상세 엔드포인트가 카드 필드를 함께 주면 이 훅은 통째로 사라진다.
 * 못 찾아도 화면은 그대로 뜨고 사진 자리만 비므로, 실패해도 안전하다.
 */
export function useEventCardBridge(eventId: string, title: string | undefined) {
  return useQuery({
    queryKey: ['events', 'card-bridge', eventId],
    enabled: Boolean(title),
    queryFn: async ({ signal }): Promise<PublicEventCard | null> => {
      const page = await apiGet<PublicEventPage>('/api/search/events', {
        withAuth: false,
        signal,
        // 검색어 상한이 40자다. 제목이 길면 잘라 보낸다 — 부분일치라 그래도 찾힌다.
        query: { keyword: (title ?? '').slice(0, 40), limit: 20 },
      });
      return page.items.find((item) => item.id === eventId) ?? null;
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/**
 * 시설 상세도 같은 사정이다. 공개 시설 단건 엔드포인트가 없어서
 * 검색 목록에서 id 가 맞는 카드를 골라 쓴다.
 */
export function useVenueCard(venueId: string) {
  return useQuery({
    queryKey: ['venues', 'card', venueId],
    queryFn: async ({ signal }): Promise<PublicVenueCard | null> => {
      const page = await apiGet<PublicVenuePage>('/api/search/venues', {
        withAuth: false,
        signal,
        query: { limit: 50, sort: 'popular' },
      });
      return page.items.find((item) => item.id === venueId) ?? null;
    },
    staleTime: 5 * 60_000,
  });
}

// ─── 내 신청 ──────────────────────────────────────────────────────────

export function useMyApplications(status?: ApplicationStatus, enabled = true) {
  return useInfiniteQuery({
    queryKey: qk.applications.list({ status: status ?? 'ALL' }),
    queryFn: ({ pageParam, signal }) =>
      apiGet<MyApplicationPage>('/api/applications/me', {
        signal,
        query: { status, limit: 20, cursor: pageParam },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
    staleTime: 10_000,
  });
}

export function useMyApplication(applicationId: string, enabled = true) {
  return useQuery({
    queryKey: qk.applications.detail(applicationId),
    queryFn: ({ signal }) =>
      apiGet<MyApplicationDetail>(`/api/applications/${encodeURIComponent(applicationId)}`, {
        signal,
      }),
    enabled,
    // 예약금 홀드가 열려 있으면 서버가 지연 만료(lazy expiry)를 한다. 주기적으로
    // 다시 물어봐야 "만료됨" 이 화면에 반영된다.
    refetchInterval: COMPETITION_REFETCH_MS,
    staleTime: 5_000,
  });
}

/**
 * 신청 계열 성공 후의 뒷정리.
 *
 * 신청 하나가 바뀌면 목록·상세·이벤트 경쟁률·알림 배지가 전부 옛날 값이 된다.
 * 화면마다 손으로 무효화하면 한 군데는 반드시 빠진다.
 */
function useInvalidateAfterApplication() {
  const queryClient = useQueryClient();

  return useCallback(
    (eventId?: string) => {
      void queryClient.invalidateQueries({ queryKey: qk.applications.all });
      void queryClient.invalidateQueries({ queryKey: qk.notifications.unreadCount });
      if (eventId) void queryClient.invalidateQueries({ queryKey: qk.events.detail(eventId) });
    },
    [queryClient],
  );
}

/**
 * 사용자의 "의도 하나"에 멱등키 하나.
 *
 * 재시도할 때마다 새 키를 만들면 서버는 그걸 **다른 요청**으로 보고 중복 신청을
 * 만든다. 그래서 키를 ref 에 붙잡아 두고, 성공했을 때만 다음 의도를 위해 버린다.
 */
function useIdempotencyKey() {
  const ref = useRef<string>(newIdempotencyKey());
  const reset = useCallback(() => {
    ref.current = newIdempotencyKey();
  }, []);
  return { ref, reset };
}

export interface ApplyVariables {
  eventId: string;
  /** BID 전용. INSTANT 는 서버가 고정 금액을 채운다. */
  amount?: number;
  agreedTermsVersion?: string;
}

export function useApplyMutation() {
  const invalidate = useInvalidateAfterApplication();
  const key = useIdempotencyKey();

  return useMutation({
    mutationFn: (body: ApplyVariables) =>
      apiPostMutate<ApplyResult>('/api/applications', body, { idempotencyKey: key.ref.current }),
    onSuccess: (result) => {
      key.reset(); // 성공했으니 다음 신청은 새 키로.
      invalidate(result.eventId);
    },
  });
}

export function useRaiseMutation(applicationId: string) {
  const invalidate = useInvalidateAfterApplication();
  const key = useIdempotencyKey();

  return useMutation({
    mutationFn: (amount: number) =>
      apiPostMutate<RaiseResult>(
        `/api/applications/${encodeURIComponent(applicationId)}/raise`,
        { amount },
        { idempotencyKey: key.ref.current },
      ),
    onSuccess: (result) => {
      key.reset();
      invalidate(result.eventId);
    },
  });
}

export function useCancelMutation(applicationId: string) {
  const invalidate = useInvalidateAfterApplication();
  const key = useIdempotencyKey();

  return useMutation({
    mutationFn: (memo?: string) =>
      apiPostMutate<CancelResult>(
        `/api/applications/${encodeURIComponent(applicationId)}/cancel`,
        memo ? { memo } : {},
        { idempotencyKey: key.ref.current },
      ),
    onSuccess: (result) => {
      key.reset();
      invalidate(result.eventId);
    },
  });
}

export function useConfirmDepositMutation(applicationId: string) {
  const invalidate = useInvalidateAfterApplication();
  const key = useIdempotencyKey();

  return useMutation({
    mutationFn: () =>
      apiPostMutate<DepositConfirmResult>(
        `/api/applications/${encodeURIComponent(applicationId)}/deposit/confirm`,
        {},
        { idempotencyKey: key.ref.current },
      ),
    onSuccess: (result) => {
      key.reset();
      invalidate(result.eventId);
    },
  });
}

// ─── 알림 · 쪽지 ──────────────────────────────────────────────────────

export function useNotifications(unreadOnly: boolean, enabled = true) {
  return useInfiniteQuery({
    queryKey: qk.notifications.list({ unreadOnly }),
    queryFn: ({ pageParam, signal }) =>
      apiGet<NotificationPage>('/api/notifications', {
        signal,
        query: { unreadOnly: unreadOnly ? true : undefined, limit: 20, cursor: pageParam },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
    staleTime: 10_000,
  });
}

export function useMessages(unreadOnly: boolean, enabled = true) {
  return useInfiniteQuery({
    queryKey: qk.messages.list({ unreadOnly }),
    queryFn: ({ pageParam, signal }) =>
      apiGet<MessagePage>('/api/messages', {
        signal,
        query: { unreadOnly: unreadOnly ? true : undefined, limit: 20, cursor: pageParam },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
    staleTime: 10_000,
  });
}

/** 알림·쪽지 목록과 배지를 한꺼번에 다시 읽는다. */
function useInvalidateInbox() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: qk.notifications.all });
    void queryClient.invalidateQueries({ queryKey: qk.messages.all });
  }, [queryClient]);
}

export function useMarkNotificationRead() {
  const invalidate = useInvalidateInbox();
  return useMutation({
    mutationFn: (id: string) =>
      apiPostMutate<{ alreadyRead?: boolean }>(
        `/api/notifications/${encodeURIComponent(id)}/read`,
      ),
    onSuccess: invalidate,
  });
}

export function useMarkMessageRead() {
  const invalidate = useInvalidateInbox();
  return useMutation({
    mutationFn: (id: string) =>
      apiPostMutate<{ alreadyRead?: boolean }>(`/api/messages/${encodeURIComponent(id)}/read`),
    onSuccess: invalidate,
  });
}

export function useMarkAllRead() {
  const invalidate = useInvalidateInbox();
  return useMutation({
    // 알림함과 쪽지함은 별개 엔드포인트다. 화면에서는 "전체 읽음" 하나로 보이므로 둘 다 부른다.
    mutationFn: async (target: 'notifications' | 'messages') =>
      target === 'notifications'
        ? apiPostMutate<{ updated: number }>('/api/notifications/read-all')
        : apiPostMutate<{ updated: number }>('/api/messages/read-all'),
    onSuccess: invalidate,
  });
}

export function useUnreadCountQuery(enabled = true) {
  return useQuery({
    queryKey: qk.notifications.unreadCount,
    queryFn: ({ signal }) => apiGet<UnreadCount>('/api/notifications/unread-count', { signal }),
    enabled,
    staleTime: 30_000,
  });
}

// ─── 알림 설정 ────────────────────────────────────────────────────────

export function useNotificationPreferences(enabled = true) {
  return useQuery({
    queryKey: qk.notifications.preferences,
    queryFn: ({ signal }) =>
      apiGet<NotificationPreferences>('/api/notifications/preferences', { signal }),
    enabled,
    staleTime: 60_000,
  });
}

export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: UpdateNotificationPreferencesBody) =>
      apiPut<NotificationPreferences>('/api/notifications/preferences', body),
    onSuccess: (next) => {
      // 응답이 곧 최신 설정이다. 다시 조회할 필요 없이 캐시에 그대로 얹는다 —
      // 토글이 눌린 뒤 한 박자 늦게 되돌아가는 깜빡임을 없앤다.
      queryClient.setQueryData(qk.notifications.preferences, next);
    },
  });
}

// ─── 파트너 전환 신청 ─────────────────────────────────────────────────

export function useSubmitPartnerApplication() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: SubmitPartnerApplicationBody) =>
      apiPostMutate<PartnerApplicationResult>('/api/auth/partner-application', body),
    onSuccess: () => {
      // 역할·승인 상태가 바뀌었을 수 있다. 헤더와 게이트가 이 값을 본다.
      void queryClient.invalidateQueries({ queryKey: qk.auth.me });
    },
  });
}
