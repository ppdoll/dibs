/**
 * 예약금 미리보기. (D-05 / D-06)
 *
 * 공개 이벤트 응답에는 예약금 규칙(정액/정률·비율·윈도우)이 실려 있지 않다.
 * 그래서 **내 신청 1건에서 규칙을 역산**한다 — 내가 적어낸 금액과 내가 내야 할
 * 금액은 둘 다 내 정보라 D-07 과 무관하고, 이 둘이면 규칙의 모양이 대개 드러난다.
 *
 * 역산은 추정이다. 정률로 딱 떨어지면 정률로 보고, 아니면 정액으로 본다.
 * 정액인데 정률로 잘못 읽으면 차액을 **더 크게** 잡는 쪽으로 틀린다 —
 * 화면 문구를 "예상"으로 두는 이유이고, 적게 안내해서 놀라게 하는 것보다 낫다.
 * 최종 금액은 언제나 서버 응답(deposit.requiredAmount)이 정한다.
 */

import {
  DEFAULT_DEPOSIT_WINDOW_MINUTES,
  depositShortfall,
  requiredDeposit,
  type DepositConfig,
} from '@dibs/shared';

import type { MyApplication } from '@/types/api';

/**
 * 신청 1건에서 이벤트의 예약금 규칙을 역산한다.
 * 예약금이 없는 이벤트면 null — 이때는 금액을 올려도 낼 돈이 없다.
 */
export function inferDepositConfig(application: MyApplication): DepositConfig | null {
  if (!application.event.depositRequired) return null;

  const need = application.deposit.requiredAmount;
  if (need <= 0) return null;

  const base = application.myAmount;

  if (base > 0) {
    // 1%~100% 중 floor(base * p / 100) === need 를 만족하는 첫 값.
    // 서버의 requiredDeposit 도 버림이라 계산이 정확히 맞아떨어진다.
    for (let percent = 1; percent <= 100; percent += 1) {
      if (Math.floor((base * percent) / 100) === need) {
        return {
          required: true,
          type: 'PERCENT',
          value: percent,
          windowMinutes: DEFAULT_DEPOSIT_WINDOW_MINUTES,
        };
      }
    }
  }

  return {
    required: true,
    type: 'FIXED',
    value: need,
    windowMinutes: DEFAULT_DEPOSIT_WINDOW_MINUTES,
  };
}

export interface RaiseDepositPreview {
  /** 새 금액에 필요한 예약금 총액 */
  required: number;
  /** 추가로 더 내야 하는 금액. 0이면 올리는 즉시 반영된다. */
  shortfall: number;
  /** 예약금 규칙을 역산으로 알아낸 값이라 확정이 아니다. */
  estimated: boolean;
}

/**
 * 금액을 nextAmount 로 올리면 예약금이 얼마나 더 필요한가.
 *
 * 차액이 남으면 새 윈도우 안에 그 돈을 내야 하고, 못 내면 직전 완납 금액으로
 * 되돌아간다(D-06). 그래서 "올리기" 버튼을 누르기 **전에** 보여줘야 한다.
 */
export function previewRaiseDeposit(
  application: MyApplication,
  nextAmount: number,
): RaiseDepositPreview {
  const config = inferDepositConfig(application);

  if (!config) return { required: 0, shortfall: 0, estimated: false };

  return {
    required: requiredDeposit(config, nextAmount),
    shortfall: depositShortfall(config, nextAmount, application.deposit.paidAmount),
    estimated: true,
  };
}
