/**
 * 파트너 콘솔에서 실패를 사람 말로 바꾸는 자리.
 *
 * 원칙: 서버가 보낸 한국어 문구를 그대로 쓴다. 프론트에서 문구를 다시 지으면
 * 서버 규칙이 바뀔 때 조용히 어긋난다. 예외는 **412 뿐**이다 — 낙관적 락 충돌은
 * 백엔드 입장에선 "version mismatch" 지만 파트너 입장에선 "다른 사람이 먼저 고쳤다"
 * 라는 전혀 다른 사건이고, 다음 행동(새로고침)까지 알려줘야 한다.
 */

import { isApiError, toUserMessage } from '@/lib/api-client';

export const STALE_VERSION_MESSAGE =
  '다른 곳에서 수정되었습니다. 새로고침 후 다시 시도해 주세요.';

/** 412 인가. If-Match 를 붙인 모든 호출이 만날 수 있다. */
export function isStaleVersion(error: unknown): boolean {
  return isApiError(error) && error.status === 412;
}

/** 화면 상단 배너 한 줄. 412 만 우리 문구로 바꾸고 나머지는 서버 문구를 그대로 쓴다. */
export function toPartnerMessage(error: unknown): string {
  if (isStaleVersion(error)) return STALE_VERSION_MESSAGE;
  return toUserMessage(error);
}

/** 필드별 빨간 글씨. 서버가 issues 를 안 보냈으면 빈 객체다. */
export function toFieldErrors(error: unknown): Record<string, string> {
  return isApiError(error) ? error.fieldErrors() : {};
}
