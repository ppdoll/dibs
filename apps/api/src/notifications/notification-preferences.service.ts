import { BadRequestException, Injectable } from '@nestjs/common';
import { DigestMode, NotificationCategory } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { isMandatoryCategory } from './notification-policy';
import type {
  NotificationPreferencesDto,
  UpdateNotificationPreferencesDto,
} from './dto/preference.dto';

const ALL_CATEGORIES = Object.values(NotificationCategory);

/**
 * 알림 설정. (D-10, IC-44)
 *
 * 설정 행이 없는 사용자가 정상이다 — 가입 시 9개 범주 x 전 유저만큼 행을 미리 만들지 않는다.
 * "행이 없으면 켜져 있다"가 기본값이고, 조회는 그 기본값을 채워서 보여주고
 * 저장은 그때 처음 행을 만든다(upsert).
 *
 * 마케팅 동의는 **두 곳에 쓴다.**
 *   - `User.marketingEmail…` / `User.marketingInApp…` — 법적 증빙 원장
 *   - `UserNotificationSetting.marketingConsent*` — 운영 미러
 * 원장에만 쓰면 발송 게이트가 매번 User 를 조인해야 하고, 미러에만 쓰면 동의 철회 증빙이
 * 운영 설정 한 줄로 덮어써질 수 있다. 둘 다 같은 트랜잭션에서 쓴다.
 */
@Injectable()
export class NotificationPreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<NotificationPreferencesDto> {
    const [rows, setting, user] = await Promise.all([
      this.prisma.notificationPreference.findMany({
        where: { userId },
        select: { category: true, inAppEnabled: true, emailEnabled: true },
      }),
      this.prisma.userNotificationSetting.findUnique({
        where: { userId },
        select: { emailGloballyEnabled: true, digestMode: true, nightMarketingConsentAt: true },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          email: true,
          notificationEmail: true,
          marketingEmailAgreedAt: true,
          marketingEmailWithdrawnAt: true,
        },
      }),
    ]);

    const byCategory = new Map(rows.map((row) => [row.category, row]));

    return {
      categories: ALL_CATEGORIES.map((category) => {
        const stored = byCategory.get(category);
        const mandatory = isMandatoryCategory(category);

        return {
          category,
          mandatory,
          // 필수 범주는 저장된 값과 무관하게 켜진 것으로 보여준다. 화면에 꺼진 채로 보이는데
          // 실제로는 발송되는 상태가 제일 나쁘다 — 사용자가 우리가 약속을 어겼다고 본다.
          inAppEnabled: mandatory ? true : (stored?.inAppEnabled ?? true),
          emailEnabled: mandatory ? true : (stored?.emailEnabled ?? true),
        };
      }),
      emailGloballyEnabled: setting?.emailGloballyEnabled ?? true,
      digestMode: setting?.digestMode ?? DigestMode.IMMEDIATE,
      marketingConsent: isConsented(user?.marketingEmailAgreedAt, user?.marketingEmailWithdrawnAt),
      nightMarketingConsent: setting?.nightMarketingConsentAt != null,
      notificationEmail: user?.notificationEmail ?? user?.email ?? null,
    };
  }

  async update(
    userId: string,
    dto: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferencesDto> {
    // 동의 시각은 순위에 닿지 않으므로 JS 시각으로 충분하다(IC-04 대상 아님).
    // 대신 한 요청 안에서는 원장과 미러가 **같은 값**이어야 대조가 가능하므로 한 번만 만든다.
    const now = new Date();

    const marketingConsent = dto.marketingConsent;
    const nightConsent = dto.nightMarketingConsent;

    await this.prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({
        where: { id: userId },
        select: { marketingEmailAgreedAt: true, marketingEmailWithdrawnAt: true },
      });

      const willConsent =
        marketingConsent ??
        isConsented(current?.marketingEmailAgreedAt, current?.marketingEmailWithdrawnAt);

      // 야간 광고 동의는 광고 동의의 하위 집합이다. 광고를 안 받겠다는 사람에게
      // "야간에는 받겠다"가 저장돼 있으면, 나중에 광고를 다시 켤 때 조용히 야간까지 열린다.
      if (nightConsent === true && !willConsent) {
        throw new BadRequestException('야간 수신 동의는 광고성 정보 수신에 동의한 뒤에 설정할 수 있습니다.');
      }

      for (const pref of dto.categories ?? []) {
        const mandatory = isMandatoryCategory(pref.category);
        // 필수 범주는 요청을 거절하지 않고 켠 채로 저장한다. 이유는 DTO 주석 참고.
        const inAppEnabled = mandatory ? true : pref.inAppEnabled;
        const emailEnabled = mandatory ? true : pref.emailEnabled;

        await tx.notificationPreference.upsert({
          where: { userId_category: { userId, category: pref.category } },
          create: { userId, category: pref.category, inAppEnabled, emailEnabled },
          update: { inAppEnabled, emailEnabled },
        });
      }

      const settingPatch = {
        ...(dto.emailGloballyEnabled === undefined
          ? {}
          : { emailGloballyEnabled: dto.emailGloballyEnabled }),
        ...(dto.digestMode === undefined ? {} : { digestMode: dto.digestMode }),
        ...(marketingConsent === undefined
          ? {}
          : marketingConsent
            ? { marketingConsentAt: now, marketingConsentWithdrawnAt: null }
            : // 철회해도 동의 시각은 지우지 않는다. "언제 동의했고 언제 철회했는가"가
              // 둘 다 남아야 광고 발송의 적법성을 증명할 수 있다.
              { marketingConsentWithdrawnAt: now, nightMarketingConsentAt: null }),
        ...(nightConsent === undefined
          ? {}
          : { nightMarketingConsentAt: nightConsent ? now : null }),
      };

      await tx.userNotificationSetting.upsert({
        where: { userId },
        create: { userId, ...settingPatch },
        update: settingPatch,
      });

      if (marketingConsent !== undefined) {
        // 법적 원장. 이메일·인앱을 함께 움직인다 — 화면에서 동의는 하나이고,
        // 둘을 쪼개면 "인앱 광고에는 동의했지만 이메일에는 안 했다"는 상태를 UI 가 표현하지 못한 채
        // DB 에만 존재하게 된다.
        await tx.user.update({
          where: { id: userId },
          data: marketingConsent
            ? {
                marketingEmailAgreedAt: now,
                marketingEmailWithdrawnAt: null,
                marketingInAppAgreedAt: now,
                marketingInAppWithdrawnAt: null,
              }
            : {
                marketingEmailWithdrawnAt: now,
                marketingInAppWithdrawnAt: now,
              },
        });
      }
    });

    return this.get(userId);
  }
}

/** 재동의하면 AgreedAt 이 WithdrawnAt 보다 뒤로 간다. 그래서 존재 여부가 아니라 순서를 본다. */
function isConsented(agreedAt: Date | null | undefined, withdrawnAt: Date | null | undefined): boolean {
  if (!agreedAt) return false;
  if (!withdrawnAt) return true;
  return withdrawnAt < agreedAt;
}
