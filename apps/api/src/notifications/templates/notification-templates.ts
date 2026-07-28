import { NotificationCategory, NotificationPriority, NotificationType } from '@prisma/client';
import { assertNoVisibilityLeak, formatKst } from '@dibs/shared';
import { z } from 'zod';

/**
 * 알림 문구 레지스트리. — D-10, IC-44
 *
 * 문구를 서비스 코드 안에 흩어 두면 D-07(경쟁률만 공개)이 반드시 깨진다.
 * "8만원에 밀리셨습니다" 한 줄이 그 이벤트의 커트라인을 전원에게 알려주는 것과 같고,
 * 그건 코드 리뷰로 잡아야 하는 종류의 실수라 언젠가 반드시 놓친다.
 *
 * 그래서 세 겹으로 막는다.
 *   1. 타입별 zod 스키마(.strict()) — 선언되지 않은 키는 애초에 못 들어온다.
 *   2. assertNoVisibilityLeak — 스키마가 잘못 늘어나도 금지 키(amount/rank/cutoff/…)를 잡는다.
 *   3. 문구 자체를 여기 한 곳에만 둔다 — 새는 문구를 찾으려면 이 파일만 보면 된다.
 *
 * 본인 금액·본인 디파짓처럼 "내 정보라 보여줘도 되는" 키는 allowPayloadKeys로 명시한다.
 * 명시하지 않으면 기본이 비공개다.
 */

export interface RenderedNotification {
  titleKo: string;
  bodyKo: string;
  deepLinkPath: string | null;
  category: NotificationCategory;
  priority: NotificationPriority;
}

interface TemplateDefinition<S extends z.ZodTypeAny> {
  category: NotificationCategory;
  priority: NotificationPriority;
  /**
   * 부분일치 금지 규칙(amount/deposit/rank/…)에 걸리지만 본인 정보라 허용되는 키.
   * "내가 낼 디파짓"은 내 정보이고, "남이 적어낸 금액"은 아니다. 그 경계가 여기다.
   */
  allowPayloadKeys?: readonly string[];
  schema: S;
  render: (payload: z.infer<S>) => {
    titleKo: string;
    bodyKo: string;
    deepLinkPath: string | null;
  };
}

const define = <S extends z.ZodTypeAny>(definition: TemplateDefinition<S>): TemplateDefinition<S> =>
  definition;

/**
 * 레지스트리에 모을 때 쓰는 넓힌 타입.
 *
 * TemplateDefinition<S>는 render의 **인자 위치**에 S가 들어가 있어서 S에 대해 무공변이다.
 * 그래서 스키마가 서로 다른 항목들을 Record<_, TemplateDefinition<ZodTypeAny>>로 검사하면
 * 전부 TS2418로 튕긴다. render의 인자를 never로 두면 반공변 규칙상 어떤 구체 payload
 * 함수든 대입할 수 있게 된다. 타입 안전은 define() 호출 시점에 이미 확보돼 있으므로
 * 여기서 넓히는 건 손해가 아니다.
 */
type ErasedTemplate = {
  category: NotificationCategory;
  priority: NotificationPriority;
  allowPayloadKeys?: readonly string[];
  schema: z.ZodTypeAny;
  render: (payload: never) => {
    titleKo: string;
    bodyKo: string;
    deepLinkPath: string | null;
  };
};

/** VarChar(120). 잘라서 넣지 않으면 도메인 트랜잭션이 문자열 길이 때문에 롤백된다. */
const TITLE_MAX = 120;

const eventTitle = z.string().min(1).max(80);
const cuid = z.string().min(1).max(40);

/** 원 단위 금액 표기. 알림에 쓰는 금액은 언제나 "본인 금액"이다. */
const won = (value: number): string => `${value.toLocaleString('ko-KR')}원`;

/**
 * 딥링크는 Next.js 내부 상대경로만 허용한다.
 * `//evil.com`은 스킴 없는 절대 URL이라 브라우저가 외부로 나간다 — 오픈 리다이렉트다.
 */
export function safeDeepLink(path: string | null): string | null {
  if (!path) return null;
  if (!path.startsWith('/') || path.startsWith('//')) return null;
  return path.slice(0, 300);
}

export const NOTIFICATION_TEMPLATES = {
  // --- 신청 ---
  [NotificationType.APPLICATION_RECEIVED]: define({
    category: NotificationCategory.APPLICATION,
    priority: NotificationPriority.NORMAL,
    schema: z.object({ eventTitle, applicationId: cuid }).strict(),
    render: (p) => ({
      titleKo: '신청이 접수되었습니다',
      bodyKo: `‘${p.eventTitle}’ 신청이 접수되었습니다. 예약금 안내를 확인해 주세요.`,
      deepLinkPath: `/my/applications/${p.applicationId}`,
    }),
  }),

  [NotificationType.APPLICATION_CONFIRMED_INSTANT]: define({
    category: NotificationCategory.APPLICATION,
    priority: NotificationPriority.HIGH,
    schema: z.object({ eventTitle, applicationId: cuid }).strict(),
    render: (p) => ({
      titleKo: '자리가 확정되었습니다',
      bodyKo: `‘${p.eventTitle}’ 자리가 확정되었습니다. 이용 안내를 확인해 주세요.`,
      deepLinkPath: `/my/applications/${p.applicationId}`,
    }),
  }),

  [NotificationType.APPLICATION_CANCELED_BY_USER]: define({
    category: NotificationCategory.APPLICATION,
    priority: NotificationPriority.NORMAL,
    schema: z.object({ eventTitle, applicationId: cuid }).strict(),
    render: (p) => ({
      titleKo: '신청이 취소되었습니다',
      bodyKo: `‘${p.eventTitle}’ 신청을 취소했습니다. 다시 신청하면 대기 시각은 새로 시작됩니다.`,
      deepLinkPath: `/my/applications/${p.applicationId}`,
    }),
  }),

  [NotificationType.APPLICATION_REJECTED_BY_PARTNER]: define({
    category: NotificationCategory.RESULT,
    priority: NotificationPriority.CRITICAL,
    schema: z.object({ eventTitle, applicationId: cuid, reasonKo: z.string().max(200).optional() }).strict(),
    render: (p) => ({
      titleKo: '신청이 반려되었습니다',
      bodyKo: p.reasonKo
        ? `‘${p.eventTitle}’ 신청이 반려되었습니다. 사유: ${p.reasonKo} 납부하신 예약금은 환불 처리됩니다.`
        : `‘${p.eventTitle}’ 신청이 반려되었습니다. 납부하신 예약금은 환불 처리됩니다.`,
      deepLinkPath: `/my/applications/${p.applicationId}`,
    }),
  }),

  // --- 예약금(디파짓) ---
  // 카운트다운이 걸린 메일이라 전부 CRITICAL이다. 마스터 스위치를 무시하고 나간다.
  [NotificationType.DEPOSIT_REQUIRED]: define({
    category: NotificationCategory.DEPOSIT,
    priority: NotificationPriority.CRITICAL,
    allowPayloadKeys: ['myDepositAmount', 'depositDueAtIso'],
    schema: z
      .object({
        eventTitle,
        applicationId: cuid,
        myDepositAmount: z.number().int().nonnegative(),
        depositDueAtIso: z.string().datetime(),
      })
      .strict(),
    render: (p) => ({
      titleKo: '예약금 납부 안내',
      bodyKo:
        `‘${p.eventTitle}’ 신청이 유효해지려면 ${won(p.myDepositAmount)}을 ` +
        `${formatKst(new Date(p.depositDueAtIso))}(KST)까지 납부해야 합니다. ` +
        `기한이 지나면 신청이 만료됩니다.`,
      deepLinkPath: `/my/applications/${p.applicationId}/deposit`,
    }),
  }),

  [NotificationType.DEPOSIT_REMINDER]: define({
    category: NotificationCategory.DEPOSIT,
    priority: NotificationPriority.CRITICAL,
    allowPayloadKeys: ['myDepositAmount', 'depositDueAtIso'],
    schema: z
      .object({
        eventTitle,
        applicationId: cuid,
        myDepositAmount: z.number().int().nonnegative(),
        depositDueAtIso: z.string().datetime(),
      })
      .strict(),
    render: (p) => ({
      titleKo: '예약금 납부 기한이 얼마 남지 않았습니다',
      bodyKo:
        `‘${p.eventTitle}’ 예약금 ${won(p.myDepositAmount)}의 납부 기한이 ` +
        `${formatKst(new Date(p.depositDueAtIso))}(KST)입니다.`,
      deepLinkPath: `/my/applications/${p.applicationId}/deposit`,
    }),
  }),

  [NotificationType.DEPOSIT_CONFIRMED]: define({
    category: NotificationCategory.DEPOSIT,
    priority: NotificationPriority.HIGH,
    allowPayloadKeys: ['myDepositAmount'],
    schema: z
      .object({ eventTitle, applicationId: cuid, myDepositAmount: z.number().int().nonnegative() })
      .strict(),
    render: (p) => ({
      titleKo: '예약금이 확인되었습니다',
      bodyKo: `‘${p.eventTitle}’ 예약금 ${won(p.myDepositAmount)}이 확인되어 신청이 유효해졌습니다.`,
      deepLinkPath: `/my/applications/${p.applicationId}`,
    }),
  }),

  [NotificationType.DEPOSIT_HOLD_EXPIRED]: define({
    category: NotificationCategory.DEPOSIT,
    priority: NotificationPriority.HIGH,
    schema: z.object({ eventTitle, applicationId: cuid }).strict(),
    render: (p) => ({
      titleKo: '예약금 기한이 지나 신청이 만료되었습니다',
      bodyKo: `‘${p.eventTitle}’ 예약금이 기한 내에 확인되지 않아 신청이 만료되었습니다.`,
      deepLinkPath: `/my/applications/${p.applicationId}`,
    }),
  }),

  [NotificationType.DEPOSIT_REFUND_SCHEDULED]: define({
    category: NotificationCategory.DEPOSIT,
    priority: NotificationPriority.NORMAL,
    allowPayloadKeys: ['myRefundAmount'],
    schema: z
      .object({ eventTitle, applicationId: cuid, myRefundAmount: z.number().int().nonnegative() })
      .strict(),
    render: (p) => ({
      titleKo: '예약금 환불이 예정되었습니다',
      bodyKo: `‘${p.eventTitle}’ 예약금 ${won(p.myRefundAmount)}의 환불이 접수되었습니다.`,
      deepLinkPath: `/my/applications/${p.applicationId}`,
    }),
  }),

  [NotificationType.DEPOSIT_REFUND_COMPLETED]: define({
    category: NotificationCategory.DEPOSIT,
    priority: NotificationPriority.HIGH,
    allowPayloadKeys: ['myRefundAmount'],
    schema: z
      .object({ eventTitle, applicationId: cuid, myRefundAmount: z.number().int().nonnegative() })
      .strict(),
    render: (p) => ({
      titleKo: '예약금 환불이 완료되었습니다',
      bodyKo: `‘${p.eventTitle}’ 예약금 ${won(p.myRefundAmount)}의 환불이 완료되었습니다.`,
      deepLinkPath: `/my/applications/${p.applicationId}`,
    }),
  }),

  // --- 재입찰 (D-06) ---
  [NotificationType.REBID_ACCEPTED]: define({
    category: NotificationCategory.APPLICATION,
    priority: NotificationPriority.NORMAL,
    allowPayloadKeys: ['myAmount'],
    schema: z
      .object({ eventTitle, applicationId: cuid, myAmount: z.number().int().nonnegative() })
      .strict(),
    render: (p) => ({
      // 순위를 알려주지 않는다. 알려주면 커트라인이 역산된다(D-07).
      titleKo: '금액 상향이 반영되었습니다',
      bodyKo: `‘${p.eventTitle}’ 신청 금액이 ${won(p.myAmount)}으로 반영되었습니다.`,
      deepLinkPath: `/my/applications/${p.applicationId}`,
    }),
  }),

  [NotificationType.REBID_DEPOSIT_SHORTFALL]: define({
    category: NotificationCategory.DEPOSIT,
    priority: NotificationPriority.CRITICAL,
    allowPayloadKeys: ['myShortfallAmount', 'depositDueAtIso'],
    schema: z
      .object({
        eventTitle,
        applicationId: cuid,
        myShortfallAmount: z.number().int().nonnegative(),
        depositDueAtIso: z.string().datetime(),
      })
      .strict(),
    render: (p) => ({
      titleKo: '상향분 예약금 차액을 납부해 주세요',
      bodyKo:
        `‘${p.eventTitle}’ 금액을 올리면서 예약금 차액 ${won(p.myShortfallAmount)}이 발생했습니다. ` +
        `${formatKst(new Date(p.depositDueAtIso))}(KST)까지 납부하지 않으면 직전 금액으로 되돌아갑니다.`,
      deepLinkPath: `/my/applications/${p.applicationId}/deposit`,
    }),
  }),

  [NotificationType.REBID_ROLLED_BACK]: define({
    category: NotificationCategory.APPLICATION,
    priority: NotificationPriority.HIGH,
    allowPayloadKeys: ['myAmount'],
    schema: z
      .object({ eventTitle, applicationId: cuid, myAmount: z.number().int().nonnegative() })
      .strict(),
    render: (p) => ({
      titleKo: '신청 금액이 직전 금액으로 되돌아갔습니다',
      bodyKo:
        `‘${p.eventTitle}’ 상향분 예약금 차액이 기한 내에 확인되지 않아 ` +
        `신청 금액이 ${won(p.myAmount)}으로 되돌아갔습니다. 신청 자체는 유효합니다.`,
      deepLinkPath: `/my/applications/${p.applicationId}`,
    }),
  }),

  // --- 이벤트 변경 ---
  [NotificationType.DEADLINE_EXTENDED]: define({
    category: NotificationCategory.EVENT_CHANGE,
    priority: NotificationPriority.NORMAL,
    schema: z.object({ eventTitle, eventId: cuid, newEndAtIso: z.string().datetime() }).strict(),
    render: (p) => ({
      titleKo: '마감이 연장되었습니다',
      bodyKo:
        `‘${p.eventTitle}’ 마감 직전 신청이 들어와 마감이 ` +
        `${formatKst(new Date(p.newEndAtIso))}(KST)로 연장되었습니다.`,
      deepLinkPath: `/events/${p.eventId}`,
    }),
  }),

  [NotificationType.EVENT_CANCELED]: define({
    category: NotificationCategory.EVENT_CHANGE,
    priority: NotificationPriority.HIGH,
    schema: z.object({ eventTitle, eventId: cuid, reasonKo: z.string().max(200).optional() }).strict(),
    render: (p) => ({
      titleKo: '이벤트가 취소되었습니다',
      bodyKo: p.reasonKo
        ? `‘${p.eventTitle}’ 이벤트가 취소되었습니다. 사유: ${p.reasonKo} 납부하신 예약금은 환불됩니다.`
        : `‘${p.eventTitle}’ 이벤트가 취소되었습니다. 납부하신 예약금은 환불됩니다.`,
      deepLinkPath: `/events/${p.eventId}`,
    }),
  }),

  [NotificationType.EVENT_CLOSED_CAPACITY_REACHED]: define({
    category: NotificationCategory.EVENT_CHANGE,
    priority: NotificationPriority.NORMAL,
    schema: z.object({ eventTitle, eventId: cuid }).strict(),
    render: (p) => ({
      titleKo: '정원이 모두 찼습니다',
      bodyKo: `‘${p.eventTitle}’ 정원이 모두 차서 신청이 마감되었습니다.`,
      deepLinkPath: `/events/${p.eventId}`,
    }),
  }),

  // --- 선정 결과 (D-07: 커트라인·순위는 어떤 문구에도 들어가지 않는다) ---
  [NotificationType.SELECTION_FINALIZED_SELECTED]: define({
    category: NotificationCategory.RESULT,
    priority: NotificationPriority.CRITICAL,
    schema: z.object({ eventTitle, applicationId: cuid }).strict(),
    render: (p) => ({
      titleKo: '선정되셨습니다',
      bodyKo: `‘${p.eventTitle}’에 선정되셨습니다. 이용 안내를 확인해 주세요.`,
      deepLinkPath: `/my/applications/${p.applicationId}`,
    }),
  }),

  [NotificationType.SELECTION_FINALIZED_NOT_SELECTED]: define({
    category: NotificationCategory.RESULT,
    priority: NotificationPriority.HIGH,
    schema: z.object({ eventTitle, applicationId: cuid }).strict(),
    render: (p) => ({
      // "얼마에 밀렸다"를 절대 쓰지 않는다. 그 한 줄이 커트라인 공개다(D-07).
      titleKo: '아쉽게도 선정되지 않았습니다',
      bodyKo: `‘${p.eventTitle}’에 선정되지 않았습니다. 납부하신 예약금은 환불됩니다.`,
      deepLinkPath: `/my/applications/${p.applicationId}`,
    }),
  }),

  [NotificationType.SELECTION_REVISED_BY_PARTNER]: define({
    category: NotificationCategory.RESULT,
    priority: NotificationPriority.HIGH,
    schema: z.object({ eventTitle, applicationId: cuid }).strict(),
    render: (p) => ({
      titleKo: '선정 결과가 수정되었습니다',
      bodyKo: `‘${p.eventTitle}’의 최종 명단이 수정되었습니다. 결과를 다시 확인해 주세요.`,
      deepLinkPath: `/my/applications/${p.applicationId}`,
    }),
  }),

  // --- 계정 / 파트너 ---
  [NotificationType.PARTNER_APPROVAL_APPROVED]: define({
    category: NotificationCategory.ACCOUNT,
    priority: NotificationPriority.HIGH,
    schema: z.object({}).strict(),
    render: () => ({
      titleKo: '파트너 승인이 완료되었습니다',
      bodyKo: '파트너 심사가 승인되었습니다. 이제 업체·시설·이벤트를 등록할 수 있습니다.',
      deepLinkPath: '/partner',
    }),
  }),

  [NotificationType.PARTNER_APPROVAL_REJECTED]: define({
    category: NotificationCategory.ACCOUNT,
    priority: NotificationPriority.HIGH,
    schema: z.object({ reasonKo: z.string().max(300).optional() }).strict(),
    render: (p) => ({
      titleKo: '파트너 심사가 반려되었습니다',
      bodyKo: p.reasonKo
        ? `파트너 심사가 반려되었습니다. 사유: ${p.reasonKo}`
        : '파트너 심사가 반려되었습니다. 신청서에서 반려 사유를 확인해 주세요.',
      deepLinkPath: '/partner/application',
    }),
  }),

  [NotificationType.PARTNER_SUSPENDED]: define({
    category: NotificationCategory.ACCOUNT,
    priority: NotificationPriority.CRITICAL,
    schema: z.object({ reasonKo: z.string().max(300).optional() }).strict(),
    render: (p) => ({
      titleKo: '파트너 활동이 정지되었습니다',
      bodyKo: p.reasonKo
        ? `파트너 활동이 정지되었습니다. 사유: ${p.reasonKo}`
        : '파트너 활동이 정지되었습니다. 자세한 내용은 고객센터로 문의해 주세요.',
      deepLinkPath: '/partner',
    }),
  }),

  [NotificationType.PARTNER_REINSTATED]: define({
    category: NotificationCategory.ACCOUNT,
    priority: NotificationPriority.HIGH,
    schema: z.object({}).strict(),
    render: () => ({
      titleKo: '파트너 활동이 재개되었습니다',
      bodyKo: '파트너 활동 정지가 해제되었습니다.',
      deepLinkPath: '/partner',
    }),
  }),

  [NotificationType.ACCOUNT_SUSPENDED]: define({
    category: NotificationCategory.ACCOUNT,
    priority: NotificationPriority.CRITICAL,
    schema: z.object({ reasonKo: z.string().max(300).optional() }).strict(),
    render: (p) => ({
      titleKo: '계정이 정지되었습니다',
      bodyKo: p.reasonKo
        ? `계정이 정지되었습니다. 사유: ${p.reasonKo}`
        : '계정이 정지되었습니다. 자세한 내용은 고객센터로 문의해 주세요.',
      deepLinkPath: '/my',
    }),
  }),

  // --- 파트너 운영 ---
  [NotificationType.PARTNER_NEW_APPLICATION_DIGEST]: define({
    category: NotificationCategory.PARTNER_OPS,
    priority: NotificationPriority.NORMAL,
    schema: z.object({ eventTitle, eventId: cuid, newApplicantCount: z.number().int().nonnegative() }).strict(),
    render: (p) => ({
      titleKo: '새 신청이 들어왔습니다',
      bodyKo: `‘${p.eventTitle}’에 새 신청 ${p.newApplicantCount}건이 접수되었습니다.`,
      deepLinkPath: `/partner/events/${p.eventId}/applicants`,
    }),
  }),

  [NotificationType.PARTNER_EVENT_DEADLINE_REACHED]: define({
    category: NotificationCategory.PARTNER_OPS,
    priority: NotificationPriority.HIGH,
    schema: z.object({ eventTitle, eventId: cuid }).strict(),
    render: (p) => ({
      titleKo: '이벤트가 마감되었습니다',
      bodyKo: `‘${p.eventTitle}’ 신청이 마감되었습니다. 최종 명단을 확정해 주세요.`,
      deepLinkPath: `/partner/events/${p.eventId}/selection`,
    }),
  }),

  [NotificationType.PARTNER_BROADCAST_BLOCKED]: define({
    category: NotificationCategory.PARTNER_OPS,
    priority: NotificationPriority.HIGH,
    schema: z.object({ broadcastId: cuid, reasonKo: z.string().max(300).optional() }).strict(),
    render: (p) => ({
      titleKo: '발송이 차단되었습니다',
      bodyKo: p.reasonKo
        ? `요청하신 공지 발송이 차단되었습니다. 사유: ${p.reasonKo}`
        : '요청하신 공지 발송이 운영정책에 따라 차단되었습니다.',
      deepLinkPath: `/partner/broadcasts/${p.broadcastId}`,
    }),
  }),

  [NotificationType.BUSINESS_VERIFICATION_APPROVED]: define({
    category: NotificationCategory.PARTNER_OPS,
    priority: NotificationPriority.HIGH,
    schema: z.object({ businessName: z.string().max(100) }).strict(),
    render: (p) => ({
      titleKo: '사업자 인증이 완료되었습니다',
      bodyKo: `‘${p.businessName}’ 사업자 인증이 승인되었습니다.`,
      deepLinkPath: '/partner/businesses',
    }),
  }),

  [NotificationType.BUSINESS_VERIFICATION_REJECTED]: define({
    category: NotificationCategory.PARTNER_OPS,
    priority: NotificationPriority.HIGH,
    schema: z.object({ businessName: z.string().max(100), reasonKo: z.string().max(300).optional() }).strict(),
    render: (p) => ({
      titleKo: '사업자 인증이 반려되었습니다',
      bodyKo: p.reasonKo
        ? `‘${p.businessName}’ 사업자 인증이 반려되었습니다. 사유: ${p.reasonKo}`
        : `‘${p.businessName}’ 사업자 인증이 반려되었습니다.`,
      deepLinkPath: '/partner/businesses',
    }),
  }),

  [NotificationType.VENUE_REVIEW_APPROVED]: define({
    category: NotificationCategory.PARTNER_OPS,
    priority: NotificationPriority.NORMAL,
    schema: z.object({ venueName: z.string().max(100), venueId: cuid }).strict(),
    render: (p) => ({
      titleKo: '시설이 공개되었습니다',
      bodyKo: `‘${p.venueName}’ 시설 검수가 통과되어 공개되었습니다.`,
      deepLinkPath: `/partner/venues/${p.venueId}`,
    }),
  }),

  [NotificationType.VENUE_REVIEW_REJECTED]: define({
    category: NotificationCategory.PARTNER_OPS,
    priority: NotificationPriority.HIGH,
    schema: z.object({ venueName: z.string().max(100), venueId: cuid, reasonKo: z.string().max(300).optional() }).strict(),
    render: (p) => ({
      titleKo: '시설 검수가 반려되었습니다',
      bodyKo: p.reasonKo
        ? `‘${p.venueName}’ 시설 검수가 반려되었습니다. 사유: ${p.reasonKo}`
        : `‘${p.venueName}’ 시설 검수가 반려되었습니다.`,
      deepLinkPath: `/partner/venues/${p.venueId}`,
    }),
  }),

  [NotificationType.VENUE_IMAGE_QUARANTINED]: define({
    category: NotificationCategory.PARTNER_OPS,
    priority: NotificationPriority.NORMAL,
    schema: z.object({ venueName: z.string().max(100), venueId: cuid }).strict(),
    render: (p) => ({
      titleKo: '시설 이미지가 비공개 처리되었습니다',
      bodyKo: `‘${p.venueName}’의 이미지 일부가 검수 대기로 전환되어 노출이 중단되었습니다.`,
      deepLinkPath: `/partner/venues/${p.venueId}/images`,
    }),
  }),

  // --- 운영자 공지 ---
  [NotificationType.ADMIN_ANNOUNCEMENT]: define({
    category: NotificationCategory.ANNOUNCEMENT,
    priority: NotificationPriority.NORMAL,
    schema: z.object({ titleKo: z.string().min(1).max(120), bodyKo: z.string().min(1).max(2000), linkPath: z.string().max(300).optional() }).strict(),
    render: (p) => ({
      titleKo: p.titleKo,
      bodyKo: p.bodyKo,
      deepLinkPath: p.linkPath ?? '/my/notifications',
    }),
  }),
} satisfies Record<NotificationType, ErasedTemplate>;

export type NotificationTemplates = typeof NOTIFICATION_TEMPLATES;

/** 타입별 payload 타입. 호출부는 이걸로 컴파일 타임에 묶인다. */
export type NotificationPayloadOf<T extends NotificationType> = z.infer<
  NotificationTemplates[T]['schema']
>;

/** 문구를 만들지 않고 범주만 알고 싶을 때(발송 게이트가 쓴다). */
export function categoryOf(type: NotificationType): NotificationCategory {
  return NOTIFICATION_TEMPLATES[type].category;
}

export function priorityOf(type: NotificationType): NotificationPriority {
  return NOTIFICATION_TEMPLATES[type].priority;
}

/**
 * payload를 검증하고 문구를 만든다.
 *
 * 검사 순서가 중요하다. **파싱보다 유출 검사가 먼저**다 —
 * 스키마가 실수로 `cutoffAmount` 같은 필드를 선언하게 되면 파싱은 통과해 버리므로,
 * 파싱된 결과만 검사하면 그 실수를 못 잡는다. 원본을 먼저 훑는다.
 */
export function renderNotification<T extends NotificationType>(
  type: T,
  payload: NotificationPayloadOf<T>,
): RenderedNotification {
  const template = NOTIFICATION_TEMPLATES[type] as ErasedTemplate;

  assertNoVisibilityLeak(payload, `알림 템플릿 ${type}`, { allow: template.allowPayloadKeys });

  const parsed = template.schema.safeParse(payload);
  if (!parsed.success) {
    // 발송하지 않는다(IC-44). 여기서 던지면 호출한 도메인 트랜잭션이 롤백되는데,
    // 그게 맞다 — 검증되지 않은 문구가 나가는 것보다 도메인 연산을 실패시키는 편이 낫다.
    throw new Error(
      `[IC-44] ${type} 알림 payload가 스키마를 통과하지 못했습니다: ${parsed.error.issues
        .map((i) => `${i.path.join('.')} ${i.message}`)
        .join(', ')}`,
    );
  }

  // ErasedTemplate.render의 인자는 never다(위 주석 참고). 실제 값은 방금
  // 그 템플릿의 스키마로 파싱한 결과이므로 런타임 타입은 정확하다.
  const rendered = template.render(parsed.data as never);

  return {
    titleKo: rendered.titleKo.slice(0, TITLE_MAX),
    bodyKo: rendered.bodyKo,
    deepLinkPath: safeDeepLink(rendered.deepLinkPath),
    category: template.category,
    priority: template.priority,
  };
}
