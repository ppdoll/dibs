import {
  AccountStatus,
  DeliverySkipReason,
  EmailSuppressionReason,
  NotificationCategory,
  NotificationPriority,
  SuppressionScope,
} from '@prisma/client';

import { decideEmailDelivery, type DeliveryGateInput } from './delivery-gate';

/**
 * 이 파일이 지키는 것은 발송량이 아니라 **두 가지 사고**다.
 *   - 필수 안내(예약금 마감)가 설정 하나로 막혀 사용자가 자리와 돈을 잃는 것
 *   - 동의 없는 광고가 나가는 것
 * 둘 다 사후에야 드러나므로 판정 순서를 테스트로 고정한다.
 */

/** 낮 시간(KST 15:00). 야간 광고 규칙이 끼어들지 않는 기준 시각. */
const DAYTIME = new Date('2026-07-27T06:00:00.000Z');
/** KST 23:00. 야간 광고 동의가 필요한 시각. */
const NIGHT = new Date('2026-07-27T14:00:00.000Z');

function input(overrides: Partial<DeliveryGateInput> = {}): DeliveryGateInput {
  return {
    category: NotificationCategory.APPLICATION,
    priority: NotificationPriority.NORMAL,
    toAddress: 'user@example.com',
    recipient: {
      status: AccountStatus.ACTIVE,
      deletedAt: null,
      marketingEmailAgreedAt: null,
      marketingEmailWithdrawnAt: null,
    },
    nightMarketingConsentAt: null,
    emailGloballyEnabled: true,
    categoryEmailEnabled: true,
    suppression: null,
    now: DAYTIME,
    ...overrides,
  };
}

describe('이메일 발송 게이트 — D-10 / IC-44', () => {
  it('마스터 스위치를 꺼도 예약금 안내는 나간다 — 그게 막히면 자리와 돈을 잃는다', () => {
    const reason = decideEmailDelivery(
      input({
        category: NotificationCategory.DEPOSIT,
        priority: NotificationPriority.CRITICAL,
        emailGloballyEnabled: false,
        categoryEmailEnabled: false,
      }),
    );

    expect(reason).toBeNull();
  });

  it('필수가 아닌 범주는 마스터 스위치에 막힌다', () => {
    const reason = decideEmailDelivery(
      input({ category: NotificationCategory.ANNOUNCEMENT, emailGloballyEnabled: false }),
    );

    expect(reason).toBe(DeliverySkipReason.GLOBAL_EMAIL_OFF);
  });

  it('하드 바운스된 주소로는 필수 범주도 보내지 않는다 — 도달하지도 않고 평판만 깎인다', () => {
    const reason = decideEmailDelivery(
      input({
        category: NotificationCategory.DEPOSIT,
        priority: NotificationPriority.CRITICAL,
        suppression: { scope: SuppressionScope.ALL, reason: EmailSuppressionReason.HARD_BOUNCE },
      }),
    );

    expect(reason).toBe(DeliverySkipReason.SUPPRESSED_BOUNCED);
  });

  it('마케팅 전용 차단은 거래성 메일을 막지 않는다', () => {
    const suppression = {
      scope: SuppressionScope.MARKETING_ONLY,
      reason: EmailSuppressionReason.USER_UNSUBSCRIBED,
    };

    expect(decideEmailDelivery(input({ category: NotificationCategory.APPLICATION, suppression }))).toBeNull();
    expect(
      decideEmailDelivery(input({ category: NotificationCategory.MARKETING, suppression })),
    ).toBe(DeliverySkipReason.SUPPRESSED_UNSUBSCRIBED);
  });

  it('동의 없는 광고는 나가지 않는다', () => {
    const reason = decideEmailDelivery(input({ category: NotificationCategory.MARKETING }));

    expect(reason).toBe(DeliverySkipReason.NO_MARKETING_CONSENT);
  });

  it('철회가 동의보다 뒤면 미동의다 — 재동의하면 다시 나간다', () => {
    const withdrawn = decideEmailDelivery(
      input({
        category: NotificationCategory.MARKETING,
        recipient: {
          status: AccountStatus.ACTIVE,
          deletedAt: null,
          marketingEmailAgreedAt: new Date('2026-01-01T00:00:00.000Z'),
          marketingEmailWithdrawnAt: new Date('2026-02-01T00:00:00.000Z'),
        },
      }),
    );
    expect(withdrawn).toBe(DeliverySkipReason.NO_MARKETING_CONSENT);

    const reAgreed = decideEmailDelivery(
      input({
        category: NotificationCategory.MARKETING,
        recipient: {
          status: AccountStatus.ACTIVE,
          deletedAt: null,
          marketingEmailAgreedAt: new Date('2026-03-01T00:00:00.000Z'),
          marketingEmailWithdrawnAt: new Date('2026-02-01T00:00:00.000Z'),
        },
      }),
    );
    expect(reAgreed).toBeNull();
  });

  it('야간(21~08시 KST) 광고는 별도 동의가 있어야 한다', () => {
    const consented = {
      status: AccountStatus.ACTIVE,
      deletedAt: null,
      marketingEmailAgreedAt: new Date('2026-01-01T00:00:00.000Z'),
      marketingEmailWithdrawnAt: null,
    };

    expect(
      decideEmailDelivery(
        input({ category: NotificationCategory.MARKETING, recipient: consented, now: NIGHT }),
      ),
    ).toBe(DeliverySkipReason.NO_NIGHT_MARKETING_CONSENT);

    expect(
      decideEmailDelivery(
        input({
          category: NotificationCategory.MARKETING,
          recipient: consented,
          now: NIGHT,
          nightMarketingConsentAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      ),
    ).toBeNull();
  });

  it('정지 계정은 비활성이 아니다 — 정지 사실을 알리는 메일이 그 계정으로 나가야 한다', () => {
    const reason = decideEmailDelivery(
      input({
        category: NotificationCategory.ACCOUNT,
        priority: NotificationPriority.CRITICAL,
        recipient: {
          status: AccountStatus.SUSPENDED,
          deletedAt: null,
          marketingEmailAgreedAt: null,
          marketingEmailWithdrawnAt: null,
        },
      }),
    );

    expect(reason).toBeNull();
  });

  it('탈퇴한 계정에는 보내지 않는다', () => {
    const reason = decideEmailDelivery(
      input({
        recipient: {
          status: AccountStatus.WITHDRAWN,
          deletedAt: null,
          marketingEmailAgreedAt: null,
          marketingEmailWithdrawnAt: null,
        },
      }),
    );

    expect(reason).toBe(DeliverySkipReason.RECIPIENT_DEACTIVATED);
  });

  it('주소가 없으면 그 사유를 남긴다 — 조용히 사라지면 왜 안 갔는지 알 수 없다', () => {
    expect(decideEmailDelivery(input({ toAddress: null }))).toBe(
      DeliverySkipReason.NO_EMAIL_ON_ACCOUNT,
    );
  });
});
