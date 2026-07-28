import { ForbiddenException } from '@nestjs/common';

import type { AuthenticatedUser } from '../../common/types/authenticated-user';

/**
 * 요청 주체의 파트너 프로필 id 를 꺼낸다.
 *
 * 모든 소유권 검사는 이 값을 **WHERE 절에** 넣어서 한다. "이 시설이 내 것인가"를
 * 별도 SELECT 로 먼저 확인하면 그 사이에 소유가 바뀌는 경합이 열리고,
 * 무엇보다 새 핸들러를 추가할 때 그 SELECT 를 빠뜨리는 순간 남의 시설이 열린다.
 */
export function requirePartnerProfileId(user: AuthenticatedUser): string {
  if (!user.partnerProfileId) {
    throw new ForbiddenException('파트너 신청서를 먼저 제출해 주세요.');
  }

  return user.partnerProfileId;
}

/** 감사 로그의 actorLabel. 계정이 지워져도 누구였는지 남겨야 한다. */
export function actorLabelOf(user: AuthenticatedUser): string {
  return `${user.displayName}<${user.email ?? 'no-email'}>`.slice(0, 120);
}
