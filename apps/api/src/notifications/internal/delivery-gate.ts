import {
  AccountStatus,
  DeliverySkipReason,
  EmailSuppressionReason,
  NotificationCategory,
  NotificationPriority,
  SuppressionScope,
} from '@prisma/client';

import {
  bypassesGlobalEmailSwitch,
  isMandatoryCategory,
  isNightMarketingHour,
} from '../notification-policy';

/**
 * 이메일 발송 게이트. (D-10, IC-44)
 *
 * 순수 함수인 이유는 하나다 — 이 판정에 실수가 있으면 사용자가 **자리와 돈을 잃거나**
 * 반대로 우리가 광고를 불법 발송한다. 둘 다 사후에 알아차리는 종류라 단위 테스트로
 * 고정할 수 있어야 하고, 그러려면 DB·시계·프로바이더가 이 안에 들어오면 안 된다.
 *
 * 판정 순서 자체가 정책이다. 특히 **차단 목록이 필수 범주보다 앞선다**:
 * 하드 바운스된 주소로는 "예약금 납부 안내"조차 보낼 수 없다. 보내봐야 도달하지 않고,
 * 계속 때리면 도메인 평판이 깎여 **다른 사람의** 거래성 메일까지 못 나가게 된다.
 */
export interface DeliveryGateInput {
  category: NotificationCategory;
  priority: NotificationPriority;
  toAddress: string | null;
  recipient: {
    status: AccountStatus;
    deletedAt: Date | null;
    marketingEmailAgreedAt: Date | null;
    marketingEmailWithdrawnAt: Date | null;
  } | null;
  /**
   * UserNotificationSetting.nightMarketingConsentAt.
   * User 가 아니라 설정 행에 있는 값이라 따로 받는다 — 마케팅 동의의 법적 원장은 User 쪽이고,
   * 야간 수신 동의는 그 원장에 대응하는 컬럼이 없어 운영 설정에만 존재한다.
   */
  nightMarketingConsentAt: Date | null;
  /** UserNotificationSetting 행이 없으면 기본값(전부 켜짐)이다. */
  emailGloballyEnabled: boolean;
  /** 해당 범주의 NotificationPreference. 행이 없으면 기본값(켜짐)이다. */
  categoryEmailEnabled: boolean;
  suppression: { scope: SuppressionScope; reason: EmailSuppressionReason } | null;
  /** DB now(). 인스턴스 벽시계를 쓰지 않는다 — 야간 광고 판정이 리전마다 갈리면 안 된다. */
  now: Date;
}

/** 보낼 수 있으면 null, 못 보내면 그 이유. */
export function decideEmailDelivery(input: DeliveryGateInput): DeliverySkipReason | null {
  if (!input.toAddress) return DeliverySkipReason.NO_EMAIL_ON_ACCOUNT;

  // 정지 계정은 "비활성"이 아니다. 정지 사실을 알리는 메일(ACCOUNT 범주)이 바로 그 계정으로
  // 나가야 하고, 그걸 막으면 사용자는 자기가 왜 못 쓰는지 영영 모른다.
  // 탈퇴(신청 포함)와 삭제만 발송을 끊는다.
  const recipient = input.recipient;
  if (!recipient) return DeliverySkipReason.RECIPIENT_DEACTIVATED;
  if (
    recipient.deletedAt !== null ||
    recipient.status === AccountStatus.WITHDRAWN ||
    recipient.status === AccountStatus.WITHDRAWAL_PENDING
  ) {
    return DeliverySkipReason.RECIPIENT_DEACTIVATED;
  }

  const isMarketing = input.category === NotificationCategory.MARKETING;

  if (input.suppression) {
    const blocked = input.suppression.scope === SuppressionScope.ALL || isMarketing;
    if (blocked) return suppressionSkipReason(input.suppression.reason);
  }

  if (isMarketing) {
    const agreedAt = recipient.marketingEmailAgreedAt;
    const withdrawnAt = recipient.marketingEmailWithdrawnAt;
    const consented = agreedAt !== null && (withdrawnAt === null || withdrawnAt < agreedAt);
    if (!consented) return DeliverySkipReason.NO_MARKETING_CONSENT;

    // 야간(21~08시 KST) 광고성 정보는 별도 동의가 필요하다.
    if (isNightMarketingHour(input.now) && input.nightMarketingConsentAt === null) {
      return DeliverySkipReason.NO_NIGHT_MARKETING_CONSENT;
    }
  }

  if (
    !input.emailGloballyEnabled &&
    !bypassesGlobalEmailSwitch(input.category, input.priority)
  ) {
    return DeliverySkipReason.GLOBAL_EMAIL_OFF;
  }

  // 필수 범주는 범주별 토글을 보지 않는다. 사용자 행에서 필수 여부를 읽지 않는 이유와 같다(IC-44).
  if (!isMandatoryCategory(input.category) && !input.categoryEmailEnabled) {
    return DeliverySkipReason.PREFERENCE_OPTED_OUT;
  }

  return null;
}

/**
 * 차단 사유를 발송 스킵 사유로 옮긴다.
 *
 * 두 열거형을 굳이 분리해 둔 이유: 차단은 "주소의 상태"이고 스킵은 "이 발송이 왜 안 나갔는가"다.
 * 같은 차단 행이 마케팅 메일에서는 스킵을, 거래성 메일에서는 발송을 만든다.
 */
export function suppressionSkipReason(reason: EmailSuppressionReason): DeliverySkipReason {
  switch (reason) {
    case EmailSuppressionReason.HARD_BOUNCE:
    case EmailSuppressionReason.SOFT_BOUNCE_THRESHOLD:
    case EmailSuppressionReason.INVALID_ADDRESS:
      return DeliverySkipReason.SUPPRESSED_BOUNCED;
    case EmailSuppressionReason.SPAM_COMPLAINT:
      return DeliverySkipReason.SUPPRESSED_COMPLAINED;
    default:
      return DeliverySkipReason.SUPPRESSED_UNSUBSCRIBED;
  }
}
