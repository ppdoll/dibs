# Dibs — API 라우트 목록

> 컨트롤러에서 자동 추출했다. 총 **167개** 엔드포인트, 컨트롤러 37개.
> 전역 prefix는 `api` (health 제외). 인증은 기본 필수이고 `public`만 열려 있다.

## `admin/admin-audit.controller.ts`

| Method | Path | Auth | 설명 |
|---|---|---|---|
| GET | `/api/admin/audit-logs` | ADMIN | 감사 로그 조회 (행위자 · 액션 · 대상 · 기간 필터) |
| GET | `/api/admin/audit-logs/verify` | ADMIN | 감사 로그 조회 (행위자 · 액션 · 대상 · 기간 필터) |
| GET | `/api/admin/audit-logs/export` | ADMIN | 체인 무결성 검사 |

## `admin/admin-billing.controller.ts`

| Method | Path | Auth | 설명 |
|---|---|---|---|
| GET | `/api/admin/billing/fees` | ADMIN | 수수료 정책 목록 |
| POST | `/api/admin/billing/fees` | ADMIN | 수수료 정책 목록 |
| POST | `/api/admin/billing/fees/:feeId/end` | ADMIN | 수수료 정책 목록 |
| GET | `/api/admin/billing/settlements` | ADMIN | 수수료 정책 종료 (삭제하지 않는다 — 과거 정산의 근거다) |
| POST | `/api/admin/billing/settlements/compute` | ADMIN | 정산 목록 |
| POST | `/api/admin/billing/settlements/:settlementId/status` | ADMIN | 정산 계산 (SETTLEMENT_ENABLED 가 켜져 있어야 한다) |

## `admin/admin-broadcasts.controller.ts`

| Method | Path | Auth | 설명 |
|---|---|---|---|
| GET | `/api/admin/broadcasts` | ADMIN | 공지 목록 |
| GET | `/api/admin/broadcasts/:broadcastId` | ADMIN | 공지 목록 |
| POST | `/api/admin/broadcasts` | ADMIN | 공지 목록 |
| POST | `/api/admin/broadcasts/:broadcastId/approve` | ADMIN | 공지 상세 (세그먼트 조건 · 진행 상황) |
| POST | `/api/admin/broadcasts/:broadcastId/schedule` | ADMIN | 공지 작성 — 세그먼트 조건을 segmentFilter 로 굳힌다 |
| POST | `/api/admin/broadcasts/:broadcastId/send` | ADMIN | 예약 발송 시각 지정/변경 |
| POST | `/api/admin/broadcasts/:broadcastId/cancel` | ADMIN | 발송(팬아웃) |

## `admin/admin-businesses.controller.ts`

| Method | Path | Auth | 설명 |
|---|---|---|---|
| GET | `/api/admin/businesses` | ADMIN | 사업자 확인 큐 (기본 PENDING · 제출 순) |
| GET | `/api/admin/businesses/:businessId` | ADMIN | 사업자 확인 큐 (기본 PENDING · 제출 순) |
| POST | `/api/admin/businesses/:businessId/verify` | ADMIN | 사업자 확인 큐 (기본 PENDING · 제출 순) |
| POST | `/api/admin/businesses/:businessId/reject` | ADMIN | 확인 완료 (PENDING → VERIFIED) |
| POST | `/api/admin/businesses/:businessId/revoke` | ADMIN | 확인 반려 (PENDING → REJECTED) |

## `admin/admin-categories.controller.ts`

| Method | Path | Auth | 설명 |
|---|---|---|---|
| GET | `/api/admin/categories` | ADMIN | 업종 트리 |
| POST | `/api/admin/categories` | ADMIN | 업종 트리 |
| PATCH | `/api/admin/categories/:categoryId` | ADMIN | 업종 추가 |
| POST | `/api/admin/categories/reorder` | ADMIN | 업종 수정 |
| DELETE | `/api/admin/categories/:categoryId` | ADMIN | 순서 재배치 |

## `admin/admin-dashboard.controller.ts`

| Method | Path | Auth | 설명 |
|---|---|---|---|
| GET | `/api/admin/dashboard/stats` | ADMIN | 대시보드 카운트 (심사 대기 · 진행 이벤트 · 오늘 신청 · 임박 홀드) |
| GET | `/api/admin/dashboard/expiring-holds` | ADMIN | 대시보드 카운트 (심사 대기 · 진행 이벤트 · 오늘 신청 · 임박 홀드) |
| GET | `/api/admin/dashboard/overdue-partners` | ADMIN | 대시보드 카운트 (심사 대기 · 진행 이벤트 · 오늘 신청 · 임박 홀드) |

## `admin/admin-event-ops.controller.ts`

| Method | Path | Auth | 설명 |
|---|---|---|---|
| GET | `/api/admin/events/ops` | ADMIN | 이벤트 목록 (운영 관점 — 정원·마감·버전) |
| GET | `/api/admin/events/ops/:eventId` | ADMIN | 이벤트 목록 (운영 관점 — 정원·마감·버전) |
| POST | `/api/admin/events/:eventId/force-close` | ADMIN | 이벤트 목록 (운영 관점 — 정원·마감·버전) |
| POST | `/api/admin/events/:eventId/extend-deadline` | ADMIN | 강제 마감 (OPEN → CLOSED) |

## `admin/admin-partners.controller.ts`

| Method | Path | Auth | 설명 |
|---|---|---|---|
| GET | `/api/admin/partners` | ADMIN | 파트너 심사 큐 (기본 PENDING · slaDueAt 오름차순) |
| GET | `/api/admin/partners/:partnerProfileId` | ADMIN | 파트너 심사 큐 (기본 PENDING · slaDueAt 오름차순) |
| POST | `/api/admin/partners/:partnerProfileId/approve` | ADMIN | 파트너 심사 큐 (기본 PENDING · slaDueAt 오름차순) |
| POST | `/api/admin/partners/:partnerProfileId/reject` | ADMIN | 승인 — 감사 로그 + 승인 알림 |
| POST | `/api/admin/partners/:partnerProfileId/request-resubmit` | ADMIN | 반려 — 반려 코드 + 사유가 파트너에게 그대로 간다 |
| POST | `/api/admin/partners/:partnerProfileId/suspend` | ADMIN | 보완 요청 — 신청서를 살려둔 채 파트너에게 공을 넘긴다 |
| POST | `/api/admin/partners/:partnerProfileId/reinstate` | ADMIN | 파트너 활동 정지 (계정 정지와는 별개) |
| POST | `/api/admin/partners/:partnerProfileId/revoke` | ADMIN | 파트너 정지 해제 |

## `admin/admin-settings.controller.ts`

| Method | Path | Auth | 설명 |
|---|---|---|---|
| GET | `/api/admin/settings` | ADMIN | 설정 목록 |
| GET | `/api/admin/settings/:key` | ADMIN | 설정 목록 |
| PUT | `/api/admin/settings/:key` | ADMIN | 설정 1건 |

## `admin/admin-users.controller.ts`

| Method | Path | Auth | 설명 |
|---|---|---|---|
| GET | `/api/admin/users` | ADMIN | 계정 검색 (이메일은 마스킹되어 나간다) |
| GET | `/api/admin/users/:userId` | ADMIN | 계정 검색 (이메일은 마스킹되어 나간다) |
| POST | `/api/admin/users/:userId/suspend` | ADMIN | 계정 검색 (이메일은 마스킹되어 나간다) |
| POST | `/api/admin/users/:userId/reinstate` | ADMIN | 계정 정지 |
| POST | `/api/admin/users/:userId/roles` | ADMIN | 계정 정지 해제 (SUSPENDED → ACTIVE) |

## `admin/admin-venues.controller.ts`

| Method | Path | Auth | 설명 |
|---|---|---|---|
| GET | `/api/admin/venues` | ADMIN | 매장 검수 큐 (기본 PENDING_REVIEW · 제출 순) |
| GET | `/api/admin/venues/:venueId` | ADMIN | 매장 검수 큐 (기본 PENDING_REVIEW · 제출 순) |
| POST | `/api/admin/venues/:venueId/approve` | ADMIN | 매장 검수 큐 (기본 PENDING_REVIEW · 제출 순) |
| POST | `/api/admin/venues/:venueId/reject` | ADMIN | 검수 승인 (PENDING_REVIEW → ACTIVE) |
| POST | `/api/admin/venues/:venueId/hide` | ADMIN | 검수 반려 (PENDING_REVIEW → DRAFT) |
| POST | `/api/admin/venues/:venueId/restore` | ADMIN | 강제 비공개 (ACTIVE → HIDDEN) |
| POST | `/api/admin/venues/:venueId/suspend` | ADMIN | 비공개 해제 (HIDDEN → ACTIVE) |
| POST | `/api/admin/venues/:venueId/unsuspend` | ADMIN | 매장 정지 (ACTIVE/HIDDEN/PENDING_REVIEW → SUSPENDED) |
| POST | `/api/admin/venues/:venueId/images/:imageId/quarantine` | ADMIN | 매장 정지 해제 |
| POST | `/api/admin/venues/:venueId/images/:imageId/release` | ADMIN | 이미지 격리 (대표 이미지였다면 대표 지정도 함께 푼다) |

## `applications/applications.controller.ts`

| Method | Path | Auth | 설명 |
|---|---|---|---|
| POST | `/api/applications` | JWT | 신청 |
| GET | `/api/applications/me` | JWT | 내 신청 목록 |
| GET | `/api/applications/:applicationId` | JWT | 내 신청 목록 |
| POST | `/api/applications/:applicationId/raise` | JWT | 내 신청 상세 |
| POST | `/api/applications/:applicationId/cancel` | JWT | 신청 취소 |
| POST | `/api/applications/:applicationId/reapply` | JWT | 취소 후 재신청 |
| POST | `/api/applications/:applicationId/deposit/confirm` | JWT | 예약금 납부 확인 |

## `auth/auth.controller.ts`

| Method | Path | Auth | 설명 |
|---|---|---|---|
| GET | `/api/auth/google` | public | 구글 로그인 시작 |
| GET | `/api/auth/google/callback` | public | 구글 로그인 시작 |
| GET | `/api/auth/me` | JWT | 내 정보 |
| POST | `/api/auth/logout` | JWT | 내 정보 |
| POST | `/api/auth/partner-application` | JWT | 로그아웃 (모든 기기) |

## `auth/dev-token.controller.ts`

| Method | Path | Auth | 설명 |
|---|---|---|---|
| POST | `/api/auth/dev-token` | public | [개발 전용] 이메일로 액세스 토큰 발급 |

## `events/event-images.controller.ts`

| Method | Path | Auth | 설명 |
|---|---|---|---|
| POST | `/api/partner/events/:eventId/images/upload-ticket` | PARTNER+approved-partner | 업로드 티켓 발급 (60초 유효) |
| POST | `/api/partner/events/:eventId/images` | PARTNER | 업로드 티켓 발급 (60초 유효) |
| GET | `/api/partner/events/:eventId/images` | PARTNER | 업로드된 이미지 등록 |
| PATCH | `/api/partner/events/:eventId/images/order` | PARTNER | 이미지 목록 |
| PATCH | `/api/partner/events/:eventId/images/:imageId` | PARTNER | 순서 재배치 |
| POST | `/api/partner/events/:eventId/images/:imageId/cover` | PARTNER | 대체 텍스트 수정 |
| DELETE | `/api/partner/events/:eventId/images/:imageId` | PARTNER | 대표 이미지 지정 |

## `events/events-admin.controller.ts`

| Method | Path | Auth | 설명 |
|---|---|---|---|
| POST | `/api/admin/events/:eventId/suspend` | ADMIN | 이벤트 정지 |
| POST | `/api/admin/events/:eventId/unsuspend` | ADMIN | 이벤트 정지 |
| POST | `/api/admin/events/:eventId/cancel` | ADMIN | 정지 해제 (statusBeforeSuspend로 복귀) |

## `events/events-cron.controller.ts`

| Method | Path | Auth | 설명 |
|---|---|---|---|
| ALL | `/api/cron/events/lifecycle` | public | SCHEDULED→OPEN, OPEN→CLOSED 상태 따라잡기 |
| ALL | `/api/cron/events/stats-refresh` | public | SCHEDULED→OPEN, OPEN→CLOSED 상태 따라잡기 |

## `events/events-public.controller.ts`

| Method | Path | Auth | 설명 |
|---|---|---|---|
| GET | `/api/events` | public | 공개 이벤트 목록 |
| GET | `/api/events/:key` | public | 공개 이벤트 목록 |

## `events/events.controller.ts`

| Method | Path | Auth | 설명 |
|---|---|---|---|
| POST | `/api/partner/events` | PARTNER+approved-partner | 이벤트 생성 (항상 DRAFT) |
| GET | `/api/partner/events` | PARTNER | 이벤트 생성 (항상 DRAFT) |
| GET | `/api/partner/events/:eventId` | PARTNER | 내 이벤트 목록 |
| PATCH | `/api/partner/events/:eventId` | PARTNER | 내 이벤트 목록 |
| DELETE | `/api/partner/events/:eventId` | PARTNER | 초안 삭제 (DRAFT만) |
| POST | `/api/partner/events/:eventId/publish` | PARTNER | 초안 삭제 (DRAFT만) |
| POST | `/api/partner/events/:eventId/close` | PARTNER | 조기 마감 (OPEN → CLOSED) |
| POST | `/api/partner/events/:eventId/cancel` | PARTNER | 취소 |

## `health.controller.ts`

| Method | Path | Auth | 설명 |
|---|---|---|---|
| GET | `/api/health` | public |  |

## `notifications/broadcasts-admin.controller.ts`

| Method | Path | Auth | 설명 |
|---|---|---|---|
| POST | `/api/admin/broadcasts` | ADMIN | 세그먼트 공지 생성 및 발송 시작 |
| GET | `/api/admin/broadcasts` | ADMIN | 세그먼트 공지 생성 및 발송 시작 |
| GET | `/api/admin/broadcasts/:id` | ADMIN | 세그먼트 공지 생성 및 발송 시작 |
| POST | `/api/admin/broadcasts/:id/approve` | ADMIN | 공지 목록 |
| POST | `/api/admin/broadcasts/:id/cancel` | ADMIN | 보류된 공지 승인 — 발송을 재개한다 |

## `notifications/messages.controller.ts`

| Method | Path | Auth | 설명 |
|---|---|---|---|
| GET | `/api/messages` | JWT | 내 쪽지 목록 (커서 페이지네이션) |
| POST | `/api/messages/read-all` | JWT | 내 쪽지 목록 (커서 페이지네이션) |
| GET | `/api/messages/:id` | JWT | 내 쪽지 목록 (커서 페이지네이션) |
| POST | `/api/messages/:id/read` | JWT | 쪽지 상세 — 읽음 처리하지 않는다 |

## `notifications/notifications-cron.controller.ts`

| Method | Path | Auth | 설명 |
|---|---|---|---|
| ALL | `/api/cron/notifications/dispatch` | public | 대기 중인 이메일 아웃박스를 집어 Resend 로 발송 |
| ALL | `/api/cron/notifications/expand-broadcasts` | public | 대기 중인 이메일 아웃박스를 집어 Resend 로 발송 |
| ALL | `/api/cron/notifications/sweep-expired` | public | 예약·확장 중인 공지의 다음 수신자 페이지를 펼친다 |

## `notifications/notifications.controller.ts`

| Method | Path | Auth | 설명 |
|---|---|---|---|
| GET | `/api/notifications` | JWT | 내 알림 목록 (커서 페이지네이션) |
| GET | `/api/notifications/unread-count` | JWT | 내 알림 목록 (커서 페이지네이션) |
| GET | `/api/notifications/preferences` | JWT | 미열람 수 (알림 + 쪽지) |
| PUT | `/api/notifications/preferences` | JWT | 알림 설정 조회 — 행이 없으면 기본값으로 채워 준다 |
| POST | `/api/notifications/read-all` | JWT | 알림 설정 변경 — 필수 범주(예약금·결과·계정)는 요청과 무관하게 켠 채로 저장된다 |
| POST | `/api/notifications/:id/read` | JWT | 전체 읽음 |
| POST | `/api/notifications/:id/archive` | JWT | 한 건 읽음 — 이미 읽었으면 alreadyRead=true 로 조용히 성공한다 |

## `notifications/partner-event-messages.controller.ts`

| Method | Path | Auth | 설명 |
|---|---|---|---|
| POST | `/api/partner/events/:eventId/messages` | PARTNER+approved-partner | 자기 이벤트 신청자에게 쪽지 발송 (상태별 필터 가능) |

## `notifications/resend-webhook.controller.ts`

| Method | Path | Auth | 설명 |
|---|---|---|---|
| POST | `/api/webhooks/resend` | public | Resend 배달 이벤트 수신 |

## `partners/businesses.controller.ts`

| Method | Path | Auth | 설명 |
|---|---|---|---|
| POST | `/api/partner/businesses` | approved-partner+PARTNER | 사업자 등록 |
| GET | `/api/partner/businesses` | approved-partner | 사업자 등록 |
| GET | `/api/partner/businesses/:businessId` | approved-partner | 내 사업자 목록 |
| PATCH | `/api/partner/businesses/:businessId` | approved-partner | 사업자 상세 |
| POST | `/api/partner/businesses/:businessId/registration-doc/upload-ticket` | approved-partner | 사업자 수정 |
| POST | `/api/partner/businesses/:businessId/registration-doc` | approved-partner | 사업자등록증 업로드 티켓 발급 |
| GET | `/api/partner/businesses/:businessId/registration-doc` | approved-partner | 사업자등록증 업로드 완료 등록 |
| POST | `/api/partner/businesses/:businessId/verification` | approved-partner | 사업자등록증 열람 URL |
| DELETE | `/api/partner/businesses/:businessId` | approved-partner | 사업자 심사 제출 |

## `partners/catalog.controller.ts`

| Method | Path | Auth | 설명 |
|---|---|---|---|
| GET | `/api/catalog/categories` | public | 업종 분류 목록 (활성 항목만, 최대 2단계 트리) |
| GET | `/api/catalog/regions` | public | 업종 분류 목록 (활성 항목만, 최대 2단계 트리) |

## `partners/partner-profile.controller.ts`

| Method | Path | Auth | 설명 |
|---|---|---|---|
| GET | `/api/partner/profile` | approved-partner+PARTNER | 내 파트너 프로필 (심사 상태·반려 사유 + 사업자/시설 집계) |

## `partners/venue-images.controller.ts`

| Method | Path | Auth | 설명 |
|---|---|---|---|
| GET | `/api/partner/venues/:venueId/images` | PARTNER+approved-partner | 시설 이미지 목록 |
| POST | `/api/partner/venues/:venueId/images/upload-ticket` | approved-partner | 시설 이미지 목록 |
| POST | `/api/partner/venues/:venueId/images/:imageId/register` | approved-partner | 이미지 업로드 티켓 발급 |
| PATCH | `/api/partner/venues/:venueId/images/order` | approved-partner | 업로드 완료 등록 (PENDING → READY) |
| PATCH | `/api/partner/venues/:venueId/images/:imageId` | approved-partner | 이미지 순서 재배치 |
| PUT | `/api/partner/venues/:venueId/images/:imageId/cover` | approved-partner | 대체 텍스트 수정 |
| DELETE | `/api/partner/venues/:venueId/images/:imageId` | approved-partner | 대표 이미지 지정 |

## `partners/venues.controller.ts`

| Method | Path | Auth | 설명 |
|---|---|---|---|
| POST | `/api/partner/venues` | PARTNER+approved-partner | 시설 생성 (DRAFT) |
| GET | `/api/partner/venues` | approved-partner | 시설 생성 (DRAFT) |
| GET | `/api/partner/venues/:venueId` | approved-partner | 내 시설 목록 |
| PATCH | `/api/partner/venues/:venueId` | approved-partner | 시설 상세 (작성 중인 시설 포함) |
| POST | `/api/partner/venues/:venueId/review-request` | approved-partner | 시설 수정 |
| POST | `/api/partner/venues/:venueId/hide` | approved-partner | 시설 심사 요청 (DRAFT → PENDING_REVIEW) |
| POST | `/api/partner/venues/:venueId/unhide` | approved-partner | 노출 중단 (ACTIVE → HIDDEN) |
| POST | `/api/partner/venues/:venueId/archive` | approved-partner | 노출 재개 (HIDDEN → ACTIVE) |
| POST | `/api/partner/venues/:venueId/restore` | approved-partner | 보관 (DRAFT/HIDDEN → ARCHIVED) |
| DELETE | `/api/partner/venues/:venueId` | approved-partner | 보관 해제 (ARCHIVED → DRAFT) |

## `search/discovery.controller.ts`

| Method | Path | Auth | 설명 |
|---|---|---|---|
| GET | `/api/discovery/home` | public | 홈 피드 (마감임박 / 신규 오픈 / 인기 / 카테고리별) |

## `search/search.controller.ts`

| Method | Path | Auth | 설명 |
|---|---|---|---|
| GET | `/api/search/events` | public | 이벤트 검색 |
| GET | `/api/search/venues` | public | 이벤트 검색 |

## `selection/selection-admin.controller.ts`

| Method | Path | Auth | 설명 |
|---|---|---|---|
| GET | `/api/admin/selections/by-event/:eventId` | ADMIN | 이벤트의 최신 선정 라운드 (커트라인 포함) |
| POST | `/api/admin/selections/by-event/:eventId/open` | ADMIN | 이벤트의 최신 선정 라운드 (커트라인 포함) |
| GET | `/api/admin/selections/:selectionId` | ADMIN | 선정 라운드 강제 개시 |
| GET | `/api/admin/selections/:selectionId/entries` | ADMIN | 라운드 상세 |

## `selection/selection-cron.controller.ts`

| Method | Path | Auth | 설명 |
|---|---|---|---|
| ALL | `/api/cron/expire-holds` | public | 만료된 예약금 홀드 스윕 (자리 반환 / 금액 롤백) |
| ALL | `/api/cron/deposit-reminders` | public | 만료된 예약금 홀드 스윕 (자리 반환 / 금액 롤백) |
| ALL | `/api/cron/finalize-rankings` | public | 확정 시각이 지난 이벤트의 선정 라운드 개시 |

## `selection/selection.controller.ts`

| Method | Path | Auth | 설명 |
|---|---|---|---|
| GET | `/api/partner/selections/by-event/:eventId` | PARTNER+approved-partner | 이벤트의 최신 선정 라운드 (커트라인 포함) |
| GET | `/api/partner/selections/by-event/:eventId/live-applicants` | PARTNER | 이벤트의 최신 선정 라운드 (커트라인 포함) |
| POST | `/api/partner/selections/by-event/:eventId/open` | PARTNER | 선정 라운드 열기 (순위 확정) |
| GET | `/api/partner/selections/:selectionId` | PARTNER | 선정 라운드 열기 (순위 확정) |
| GET | `/api/partner/selections/:selectionId/entries` | PARTNER | 라운드 상세 (커트라인 포함) |
| GET | `/api/partner/selections/:selectionId/export.csv` | PARTNER | 순위순 신청자 목록 (금액 포함) |
| POST | `/api/partner/selections/:selectionId/auto-preselect` | PARTNER | 명단 CSV 내려받기 |
| POST | `/api/partner/selections/:selectionId/entries/:entryId/add` | PARTNER | 수동 추가 (순위 밖 후보를 명단에) |
| POST | `/api/partner/selections/:selectionId/entries/:entryId/remove` | PARTNER | 수동 제외 |
| POST | `/api/partner/selections/:selectionId/entries/:entryId/promote` | PARTNER | 결원 승계 |
| POST | `/api/partner/selections/:selectionId/finalize` | PARTNER | 명단 확정 (되돌릴 수 없음) |

## `tick/tick.controller.ts`

| Method | Path | Auth | 설명 |
|---|---|---|---|
| ALL | `/api/cron/tick` | public+cron | 등록된 스케줄 잡을 순서대로 전부 실행 |

