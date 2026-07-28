/**
 * 파트너 콘솔이 부르는 엔드포인트 목록.
 *
 * 경로는 `docs/API-ROUTES.md` 에 적힌 그대로 쓴다(`/api` 포함). 화면 코드가 경로 문자열을
 * 직접 들고 있지 않게 여기 한 겹을 둔다 — 오타 하나가 런타임에서만 드러나는 걸 막고,
 * "이 화면이 무슨 API 를 쓰는가" 를 파일 하나로 답할 수 있게 하기 위해서다.
 *
 * ★ If-Match: 시설·이벤트·선정 라운드의 상태 변경은 전부 낙관적 락이다. 파트너 계정은
 *   여러 직원이 함께 쓰고 화면을 오래 열어두는 물건이라, 버전 없이 저장하면 옆자리에서
 *   방금 고친 값이 조용히 되돌아간다. 412 는 실패가 아니라 "다시 읽어라" 라는 신호다.
 */

import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from '@/lib/api-client';
import type { CursorPage } from '@/types/api';
import type {
  BlobUploadTicket,
  CancelEventBody,
  CatalogCategory,
  CatalogRegion,
  CloseEventBody,
  CreateBusinessBody,
  CreateEventBody,
  CreateVenueBody,
  EventImageUploadTicket,
  PartnerBusinessResponse,
  PartnerEventDetail,
  PartnerEventImage,
  PartnerProfileDetail,
  PartnerSelectionEntry,
  PartnerSelectionRound,
  PartnerVenueDetail,
  PartnerVenueImage,
  PartnerVenuePage,
  SelectionEntryQuery,
  UpdateBusinessBody,
  UpdateEventBody,
  UpdateVenueBody,
  VenueImageUploadTicket,
} from './types';
import type { EventStatus, PartnerEvent, VenueStatus } from '@/types/api';

/** If-Match 헤더 한 줄. 숫자를 문자열로 바꾸는 자리를 한 곳으로 모은다. */
function ifMatch(version: number): Record<string, string> {
  return { 'If-Match': String(version) };
}

// ─── 파트너 프로필 ────────────────────────────────────────────────────

export function getPartnerProfile(): Promise<PartnerProfileDetail> {
  return apiGet<PartnerProfileDetail>('/api/partner/profile');
}

export interface SubmitPartnerApplicationBody {
  contactName: string;
  contactEmail: string;
  contactPhone?: string;
  partnerTermsVersion: string;
}

export function submitPartnerApplication(
  body: SubmitPartnerApplicationBody,
): Promise<{ id: string; approvalStatus: string; submittedAt: string | null; slaDueAt: string | null }> {
  return apiPost('/api/auth/partner-application', body);
}

// ─── 카탈로그 (폼 드롭다운) ───────────────────────────────────────────

export function listCategories(parentId?: string): Promise<CatalogCategory[]> {
  return apiGet<CatalogCategory[]>('/api/catalog/categories', {
    withAuth: false,
    ...(parentId ? { query: { parentId } } : {}),
  });
}

export function listRegions(params: {
  level?: 'SIDO' | 'SIGUNGU';
  parentCode?: string;
}): Promise<CatalogRegion[]> {
  return apiGet<CatalogRegion[]>('/api/catalog/regions', { withAuth: false, query: params });
}

// ─── 사업자 ───────────────────────────────────────────────────────────

export function listBusinesses(): Promise<PartnerBusinessResponse[]> {
  return apiGet<PartnerBusinessResponse[]>('/api/partner/businesses');
}

export function getBusiness(businessId: string): Promise<PartnerBusinessResponse> {
  return apiGet<PartnerBusinessResponse>(`/api/partner/businesses/${businessId}`);
}

export function createBusiness(body: CreateBusinessBody): Promise<PartnerBusinessResponse> {
  return apiPost<PartnerBusinessResponse>('/api/partner/businesses', body);
}

export function updateBusiness(
  businessId: string,
  body: UpdateBusinessBody,
): Promise<PartnerBusinessResponse> {
  return apiPatch<PartnerBusinessResponse>(`/api/partner/businesses/${businessId}`, body);
}

export function createBusinessDocTicket(
  businessId: string,
  contentType: string,
): Promise<BlobUploadTicket> {
  return apiPost<BlobUploadTicket>(
    `/api/partner/businesses/${businessId}/registration-doc/upload-ticket`,
    { contentType },
  );
}

export function attachBusinessDoc(
  businessId: string,
  body: { pathname: string; blobUrl: string },
): Promise<PartnerBusinessResponse> {
  return apiPost<PartnerBusinessResponse>(
    `/api/partner/businesses/${businessId}/registration-doc`,
    body,
  );
}

/** 열람 URL 은 만료가 짧다. 받은 즉시 새 탭으로 연다. */
export function resolveBusinessDoc(
  businessId: string,
): Promise<{ url: string; expiresAt: string }> {
  return apiGet(`/api/partner/businesses/${businessId}/registration-doc`);
}

export function submitBusinessVerification(
  businessId: string,
  memo?: string,
): Promise<PartnerBusinessResponse> {
  return apiPost<PartnerBusinessResponse>(
    `/api/partner/businesses/${businessId}/verification`,
    memo ? { memo } : {},
  );
}

export function deleteBusiness(businessId: string): Promise<void> {
  return apiDelete<void>(`/api/partner/businesses/${businessId}`);
}

// ─── 시설 ─────────────────────────────────────────────────────────────

export function listVenues(params: {
  status?: VenueStatus;
  businessId?: string;
  cursor?: string;
  limit?: number;
}): Promise<PartnerVenuePage> {
  return apiGet<PartnerVenuePage>('/api/partner/venues', { query: params });
}

export function getVenue(venueId: string): Promise<PartnerVenueDetail> {
  return apiGet<PartnerVenueDetail>(`/api/partner/venues/${venueId}`);
}

export function createVenue(body: CreateVenueBody): Promise<PartnerVenueDetail> {
  return apiPost<PartnerVenueDetail>('/api/partner/venues', body);
}

export function updateVenue(
  venueId: string,
  version: number,
  body: UpdateVenueBody,
): Promise<PartnerVenueDetail> {
  return apiPatch<PartnerVenueDetail>(`/api/partner/venues/${venueId}`, body, {
    headers: ifMatch(version),
  });
}

export function requestVenueReview(venueId: string): Promise<PartnerVenueDetail> {
  return apiPost<PartnerVenueDetail>(`/api/partner/venues/${venueId}/review-request`);
}

export function hideVenue(venueId: string, reason?: string): Promise<PartnerVenueDetail> {
  return apiPost<PartnerVenueDetail>(
    `/api/partner/venues/${venueId}/hide`,
    reason ? { reason } : {},
  );
}

export function unhideVenue(venueId: string): Promise<PartnerVenueDetail> {
  return apiPost<PartnerVenueDetail>(`/api/partner/venues/${venueId}/unhide`);
}

export function archiveVenue(venueId: string): Promise<PartnerVenueDetail> {
  return apiPost<PartnerVenueDetail>(`/api/partner/venues/${venueId}/archive`);
}

export function restoreVenue(venueId: string): Promise<PartnerVenueDetail> {
  return apiPost<PartnerVenueDetail>(`/api/partner/venues/${venueId}/restore`);
}

// ─── 시설 이미지 ──────────────────────────────────────────────────────

export function listVenueImages(venueId: string): Promise<PartnerVenueImage[]> {
  return apiGet<PartnerVenueImage[]>(`/api/partner/venues/${venueId}/images`);
}

export function createVenueImageTicket(
  venueId: string,
  contentType: string,
): Promise<VenueImageUploadTicket> {
  return apiPost<VenueImageUploadTicket>(
    `/api/partner/venues/${venueId}/images/upload-ticket`,
    { contentType },
  );
}

export function registerVenueImage(
  venueId: string,
  imageId: string,
  body: { blobUrl: string; width: number; height: number; altText?: string },
): Promise<PartnerVenueImage> {
  return apiPost<PartnerVenueImage>(
    `/api/partner/venues/${venueId}/images/${imageId}/register`,
    body,
  );
}

/**
 * 순서 재배치. **살아 있는 이미지 전체**를 원하는 순서로 보낸다.
 * 일부만 보내면 서버의 2단계 쓰기가 대피시키지 못한 행과 충돌한다.
 */
export function reorderVenueImages(
  venueId: string,
  imageIds: string[],
): Promise<PartnerVenueImage[]> {
  return apiPatch<PartnerVenueImage[]>(`/api/partner/venues/${venueId}/images/order`, {
    imageIds,
  });
}

export function updateVenueImageAlt(
  venueId: string,
  imageId: string,
  altText: string,
): Promise<PartnerVenueImage> {
  return apiPatch<PartnerVenueImage>(`/api/partner/venues/${venueId}/images/${imageId}`, {
    altText,
  });
}

export function setVenueImageCover(
  venueId: string,
  imageId: string,
): Promise<PartnerVenueImage[]> {
  return apiPut<PartnerVenueImage[]>(
    `/api/partner/venues/${venueId}/images/${imageId}/cover`,
  );
}

export function deleteVenueImage(venueId: string, imageId: string): Promise<void> {
  return apiDelete<void>(`/api/partner/venues/${venueId}/images/${imageId}`);
}

// ─── 이벤트 ───────────────────────────────────────────────────────────

export function listPartnerEvents(params: {
  status?: EventStatus;
  venueId?: string;
  cursor?: string;
  limit?: number;
}): Promise<CursorPage<PartnerEvent>> {
  return apiGet<CursorPage<PartnerEvent>>('/api/partner/events', { query: params });
}

export function getPartnerEvent(eventId: string): Promise<PartnerEventDetail> {
  return apiGet<PartnerEventDetail>(`/api/partner/events/${eventId}`);
}

export function createEvent(body: CreateEventBody): Promise<PartnerEventDetail> {
  return apiPost<PartnerEventDetail>('/api/partner/events', body);
}

export function updateEvent(
  eventId: string,
  version: number,
  body: UpdateEventBody,
): Promise<PartnerEventDetail> {
  return apiPatch<PartnerEventDetail>(`/api/partner/events/${eventId}`, body, {
    headers: ifMatch(version),
  });
}

export function deleteEventDraft(eventId: string, version: number): Promise<void> {
  return apiDelete<void>(`/api/partner/events/${eventId}`, { headers: ifMatch(version) });
}

export function publishEvent(eventId: string, version: number): Promise<PartnerEventDetail> {
  return apiPost<PartnerEventDetail>(`/api/partner/events/${eventId}/publish`, undefined, {
    headers: ifMatch(version),
  });
}

export function closeEvent(
  eventId: string,
  version: number,
  body: CloseEventBody,
): Promise<PartnerEventDetail> {
  return apiPost<PartnerEventDetail>(`/api/partner/events/${eventId}/close`, body, {
    headers: ifMatch(version),
  });
}

export function cancelEvent(
  eventId: string,
  version: number,
  body: CancelEventBody,
): Promise<PartnerEventDetail> {
  return apiPost<PartnerEventDetail>(`/api/partner/events/${eventId}/cancel`, body, {
    headers: ifMatch(version),
  });
}

// ─── 이벤트 이미지 ────────────────────────────────────────────────────

export function listEventImages(eventId: string): Promise<PartnerEventImage[]> {
  return apiGet<PartnerEventImage[]>(`/api/partner/events/${eventId}/images`);
}

export function createEventImageTicket(
  eventId: string,
  contentType: string,
): Promise<EventImageUploadTicket> {
  return apiPost<EventImageUploadTicket>(
    `/api/partner/events/${eventId}/images/upload-ticket`,
    { contentType },
  );
}

export function registerEventImage(
  eventId: string,
  body: {
    imageId: string;
    blobUrl: string;
    width: number;
    height: number;
    altText?: string;
    isCover?: boolean;
  },
): Promise<PartnerEventImage> {
  return apiPost<PartnerEventImage>(`/api/partner/events/${eventId}/images`, body);
}

export function reorderEventImages(
  eventId: string,
  imageIds: string[],
): Promise<PartnerEventImage[]> {
  return apiPatch<PartnerEventImage[]>(`/api/partner/events/${eventId}/images/order`, {
    imageIds,
  });
}

export function setEventImageCover(
  eventId: string,
  imageId: string,
): Promise<PartnerEventImage[]> {
  return apiPost<PartnerEventImage[]>(
    `/api/partner/events/${eventId}/images/${imageId}/cover`,
  );
}

export function deleteEventImage(eventId: string, imageId: string): Promise<void> {
  return apiDelete<void>(`/api/partner/events/${eventId}/images/${imageId}`);
}

// ─── 선정 (당첨자 발표) ───────────────────────────────────────────────

export function getSelectionByEvent(eventId: string): Promise<PartnerSelectionRound> {
  return apiGet<PartnerSelectionRound>(`/api/partner/selections/by-event/${eventId}`);
}

export function openSelectionRound(eventId: string): Promise<PartnerSelectionRound> {
  return apiPost<PartnerSelectionRound>(`/api/partner/selections/by-event/${eventId}/open`);
}

export function getSelectionRound(selectionId: string): Promise<PartnerSelectionRound> {
  return apiGet<PartnerSelectionRound>(`/api/partner/selections/${selectionId}`);
}

export function listSelectionEntries(
  selectionId: string,
  query: SelectionEntryQuery,
): Promise<CursorPage<PartnerSelectionEntry>> {
  return apiGet<CursorPage<PartnerSelectionEntry>>(
    `/api/partner/selections/${selectionId}/entries`,
    { query: { ...query } },
  );
}

/** CSV 는 text/csv 로 오므로 api-client 가 문자열 그대로 돌려준다. */
export function exportSelectionCsv(selectionId: string): Promise<string> {
  return apiGet<string>(`/api/partner/selections/${selectionId}/export.csv`);
}

export function autoPreselect(
  selectionId: string,
  version: number,
  topN?: number,
): Promise<PartnerSelectionRound> {
  return apiPost<PartnerSelectionRound>(
    `/api/partner/selections/${selectionId}/auto-preselect`,
    topN === undefined ? {} : { topN },
    { headers: ifMatch(version) },
  );
}

export function addSelectionEntry(
  selectionId: string,
  entryId: string,
  version: number,
  reason?: string,
): Promise<PartnerSelectionRound> {
  return apiPost<PartnerSelectionRound>(
    `/api/partner/selections/${selectionId}/entries/${entryId}/add`,
    reason ? { reason } : {},
    { headers: ifMatch(version) },
  );
}

export function removeSelectionEntry(
  selectionId: string,
  entryId: string,
  version: number,
  reason?: string,
): Promise<PartnerSelectionRound> {
  return apiPost<PartnerSelectionRound>(
    `/api/partner/selections/${selectionId}/entries/${entryId}/remove`,
    reason ? { reason } : {},
    { headers: ifMatch(version) },
  );
}

export function promoteSelectionEntry(
  selectionId: string,
  entryId: string,
  version: number,
  body: { fromEntryId: string; reason?: string },
): Promise<PartnerSelectionRound> {
  return apiPost<PartnerSelectionRound>(
    `/api/partner/selections/${selectionId}/entries/${entryId}/promote`,
    body,
    { headers: ifMatch(version) },
  );
}

export function finalizeSelection(
  selectionId: string,
  version: number,
  memo?: string,
): Promise<PartnerSelectionRound> {
  return apiPost<PartnerSelectionRound>(
    `/api/partner/selections/${selectionId}/finalize`,
    memo ? { memo } : {},
    { headers: ifMatch(version) },
  );
}

// ─── 신청자 쪽지 ──────────────────────────────────────────────────────
//
// 여기 있던 sendEventMessage()는 제거했다. 백엔드가 body.idempotencyKey를 필수로 받는데
// 그 helper는 보내지 않아 호출하는 순간 400이 나는 물건이었다. 호출자는 없었지만,
// 남겨두면 다음 사람이 집어 쓴다. 실제 발송은
// events/[eventId]/_lib/live-api.ts 의 sendEventBroadcast()를 쓴다 — 키를 포함한다.
