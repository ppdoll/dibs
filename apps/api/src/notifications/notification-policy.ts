import { NotificationCategory, NotificationPriority } from '@prisma/client';
import { toKstParts } from '@dibs/shared';

/**
 * 발송 정책 상수. — IC-44
 *
 * "필수 범주인가"는 **범주의 성질**이지 사용자의 성질이 아니다. DB 컬럼
 * (NotificationPreference.isMandatory)에서 읽으면 통짜 PUT 한 번으로 DEPOSIT을
 * 옵트아웃할 수 있고, 그러면 DEPOSIT_REQUIRED를 못 받아 자리와 돈을 동시에 잃는다.
 * 그래서 코드 상수에서만 파생시킨다.
 *
 * NOTE(orchestrator): IC-44 원문은 이 맵의 자리를 `packages/shared`로 지목한다.
 * 지금은 알림 모듈이 유일한 소비자라 여기 둔다 — 다른 모듈이 이 판정을 필요로 하는
 * 순간 shared로 올려야 한다. 그 전까지 두 벌로 복사하지 말 것.
 */
export const MANDATORY_CATEGORIES = [
  NotificationCategory.DEPOSIT,
  NotificationCategory.RESULT,
  NotificationCategory.ACCOUNT,
] as const;

export function isMandatoryCategory(category: NotificationCategory): boolean {
  return (MANDATORY_CATEGORIES as readonly NotificationCategory[]).includes(category);
}

/**
 * 마스터 이메일 스위치(UserNotificationSetting.emailGloballyEnabled)를 무시해도 되는가.
 *
 * 필수 범주와 CRITICAL 거래성 메일만 무시한다. 마케팅이 이 예외를 타면
 * 마스터 스위치가 장식이 되고, 반대로 디파짓 마감 안내가 이 예외를 못 타면
 * 사용자가 스위치 하나로 돈을 잃는다.
 */
export function bypassesGlobalEmailSwitch(
  category: NotificationCategory,
  priority: NotificationPriority,
): boolean {
  return isMandatoryCategory(category) || priority === NotificationPriority.CRITICAL;
}

/** 야간(21:00~08:00 KST) 광고성 정보는 별도 동의가 필요하다. */
export const NIGHT_MARKETING_START_HOUR_KST = 21;
export const NIGHT_MARKETING_END_HOUR_KST = 8;

/**
 * 로컬 시계에 의존하는 Date 메서드(getHours)를 쓰지 않는 이유는 서버리스 인스턴스가
 * 어느 리전에서 뜰지 모르기 때문이다. shared의 toKstParts는 UTC 기준으로 KST를 만든다.
 */
export function isNightMarketingHour(at: Date): boolean {
  const { hour } = toKstParts(at);
  return hour >= NIGHT_MARKETING_START_HOUR_KST || hour < NIGHT_MARKETING_END_HOUR_KST;
}

/**
 * 재시도 백오프(초). 인덱스 = 이미 실패한 횟수.
 *
 * 5xx·타임아웃은 프로바이더 쪽 일시 장애라 곧바로 다시 때리면 같은 이유로 또 실패한다.
 * 마지막 간격이 3시간인 이유: maxAttempts(5)를 다 쓰면 약 4시간에 걸쳐 시도하게 되어,
 * 짧은 장애는 전부 흡수하면서도 디파짓 마감(10분)을 넘긴 메일이 뒤늦게 나가지는 않는다.
 */
const RETRY_BACKOFF_SECONDS = [60, 300, 900, 3_600, 10_800] as const;

export function retryDelaySeconds(attemptCount: number): number {
  const index = Math.max(0, Math.min(attemptCount - 1, RETRY_BACKOFF_SECONDS.length - 1));
  // index를 배열 범위 안으로 이미 clamp했지만 noUncheckedIndexedAccess가 undefined를 붙인다.
  // 마지막 간격으로 떨어뜨리는 게 안전한 기본값이다.
  return RETRY_BACKOFF_SECONDS[index] ?? RETRY_BACKOFF_SECONDS[RETRY_BACKOFF_SECONDS.length - 1]!;
}

/** 배치를 잡아두는 시간. 함수 타임아웃(60s)보다 넉넉해야 죽은 배치가 영원히 잠기지 않는다. */
export const DISPATCH_LEASE_SECONDS = 180;

/** 웹훅 타임스탬프 허용 오차. Svix 권장값과 같다. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;
