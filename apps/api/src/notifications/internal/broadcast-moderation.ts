/**
 * 파트너·운영자가 직접 쓴 공지 문구를 D-07 관점에서 훑는다. (D-07, D-10)
 *
 * 템플릿 알림은 zod 스키마로 막을 수 있지만 **사람이 쓴 자유 문구는 못 막는다.**
 * "이번 커트라인은 8만원이었습니다" 한 줄이면 그 이벤트의 밀봉 입찰이 통째로 무너지고,
 * 한 번 보낸 쪽지는 회수할 수 없다.
 *
 * 그래서 기계는 **판정하지 않고 보류**만 한다. 정규식으로 커트라인 공개를 완벽히 잡는 건
 * 불가능하고, 과하게 잡으면 파트너가 정상 공지를 못 보낸다. 걸리면 운영자 승인 큐로 넘긴다 —
 * 오탐의 비용은 "승인 한 번"이고, 미탐의 비용은 "되돌릴 수 없는 정보 유출"이다.
 */

/** 금액 표기. '80,000원' / '8만원' / '80000 원' 을 모두 잡는다. */
const AMOUNT_PATTERN = /(\d{1,3}(,\d{3})+|\d+\s*만|\d{4,})\s*원/;

/** 순위·커트라인 어휘. 금액과 함께 나오면 커트라인 공개일 가능성이 높다. */
const RANK_PATTERN = /(커트라인|컷트라인|컷라인|최저\s*낙찰|낙찰가|몇\s*등|등수|순위|랭킹)/;

/** 어휘만으로도 즉시 보류하는 표현. 금액이 없어도 순위 공개 그 자체다. */
const HARD_PATTERN = /(커트라인|컷트라인|컷라인|최저\s*낙찰|낙찰가|귀하의\s*순위|고객님의\s*순위)/;

export interface ModerationVerdict {
  flagged: boolean;
  /** 운영자에게 보여줄 사유. 발송이 막힌 파트너에게도 요약해서 전달한다. */
  reasonKo: string | null;
}

export function screenBroadcastText(titleKo: string, bodyKo: string): ModerationVerdict {
  const text = `${titleKo}\n${bodyKo}`;

  if (HARD_PATTERN.test(text)) {
    return {
      flagged: true,
      reasonKo: '커트라인·순위를 직접 언급하는 표현이 포함되어 있습니다. (D-07)',
    };
  }

  if (AMOUNT_PATTERN.test(text) && RANK_PATTERN.test(text)) {
    return {
      flagged: true,
      reasonKo: '금액과 순위 표현이 함께 있어 커트라인이 역산될 수 있습니다. (D-07)',
    };
  }

  return { flagged: false, reasonKo: null };
}
