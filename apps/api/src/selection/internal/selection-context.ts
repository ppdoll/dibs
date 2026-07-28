import { ForbiddenException, HttpException } from '@nestjs/common';
import { AuditActorRole, UserRole } from '@prisma/client';

import type { AuthenticatedUser } from '../../common/types/authenticated-user';

/**
 * 요청 주체의 파트너 프로필 id.
 *
 * 소유권은 언제나 **WHERE 절에서** 확인한다. "이 라운드가 내 것인가"를 별도 SELECT 로 먼저 보면
 * 그 사이가 경합 창이고, 새 핸들러에서 그 SELECT 를 빠뜨리는 순간 남의 이벤트 명단이 열린다.
 * @RequireApprovedPartner() 는 "승인된 파트너인가"만 보지 "이 행이 그 파트너 것인가"는 보지 않는다.
 *
 * (events 모듈에도 같은 함수가 있다. 가져다 쓰지 않고 복제한 이유는 모듈 간 결합을 만들지 않기
 *  위해서다 — 이 모듈은 DB 로만 다른 애그리게이트에 닿는다.)
 */
export function requirePartnerProfileId(user: AuthenticatedUser): string {
  if (!user.partnerProfileId) {
    throw new ForbiddenException('파트너 신청서를 먼저 제출해 주세요.');
  }

  return user.partnerProfileId;
}

export function isAdmin(user: AuthenticatedUser): boolean {
  return user.roles.includes(UserRole.ADMIN);
}

/**
 * 소유권 술어에 쓸 partnerId.
 *
 * 운영자는 `null` 을 받아 술어 자체가 빠진다 — 운영자 화면은 남의 이벤트도 봐야 하고,
 * 그 접근은 감사 로그가 대신 책임진다. 파트너는 반드시 자기 프로필 id 로 좁혀진다.
 */
export function ownerScopeOf(user: AuthenticatedUser): string | null {
  return isAdmin(user) ? null : requirePartnerProfileId(user);
}

export function actorRoleOf(user: AuthenticatedUser): AuditActorRole {
  return isAdmin(user) ? AuditActorRole.ADMIN : AuditActorRole.PARTNER;
}

/** 감사 로그의 actorLabel. 계정이 지워져도 누구였는지 남아야 한다. */
export function actorLabelOf(user: AuthenticatedUser): string {
  return `${user.displayName}<${user.email ?? 'no-email'}>`.slice(0, 120);
}

/**
 * If-Match 헤더에서 낙관적 락 토큰을 꺼낸다. 선정 라운드에서는 `Selection.version` 이다.
 *
 * 없으면 428 이다 — "요청이 틀렸다"(400)가 아니라 "전제 조건을 먼저 걸어라"이고, 클라이언트는
 * 재조회해서 version 을 실어 다시 보내면 된다. 옵션으로 두면 그걸 안 보내는 클라이언트가 하나
 * 생기는 순간 두 명이 동시에 명단을 확정하는 경로가 열린다.
 */
const HTTP_PRECONDITION_REQUIRED = 428;

export function parseIfMatchVersion(raw: string | undefined): number {
  const cleaned = raw?.trim().replace(/^W\//, '').replace(/^"|"$/g, '');
  const version = Number(cleaned);

  if (!cleaned || !Number.isInteger(version) || version < 0) {
    throw new HttpException(
      {
        code: 'IF_MATCH_REQUIRED',
        hint: 'If-Match 헤더에 조회 시 받은 Selection.version 값을 넣어 주세요.',
      },
      HTTP_PRECONDITION_REQUIRED,
    );
  }

  return version;
}
