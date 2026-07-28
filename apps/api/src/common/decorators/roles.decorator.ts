import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@prisma/client';

export const ROLES_KEY = 'dibs:roles';

/**
 * 이 엔드포인트를 쓸 수 있는 역할. 하나라도 가지고 있으면 통과한다.
 *
 * 주의: PARTNER 역할이 있다는 것과 파트너로 활동할 수 있다는 것은 다르다.
 * 운영자 승인 전에는 역할만 있고 활동은 못 한다. 승인까지 요구하려면
 * @RequireApprovedPartner()를 함께 붙인다. (D-09)
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

export const APPROVED_PARTNER_KEY = 'dibs:approvedPartner';

/**
 * 운영자 승인을 마친 파트너만 통과시킨다.
 *
 * 업체·시설·이벤트를 만들거나 신청자에게 발송하는 등 **바깥에 영향을 주는**
 * 행동에 붙인다. 자기 신청서를 보거나 수정하는 것처럼 승인 전에도
 * 해야 하는 일에는 붙이지 않는다.
 */
export const RequireApprovedPartner = () => SetMetadata(APPROVED_PARTNER_KEY, true);
