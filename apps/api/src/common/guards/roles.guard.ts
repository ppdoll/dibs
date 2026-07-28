import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { UserRole } from '@prisma/client';

import { APPROVED_PARTNER_KEY, ROLES_KEY } from '../decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AuthenticatedUser } from '../types/authenticated-user';

/**
 * 역할과 파트너 승인 여부를 본다. JwtAuthGuard 다음에 돈다.
 *
 * 역할 검사와 승인 검사를 분리한 이유: 파트너는 가입 직후에도 자기
 * 신청서를 보고 고쳐야 한다. 승인 전 전면 차단하면 반려 사유를 확인할
 * 방법조차 없어진다. (D-09)
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, targets);
    const needsApproval = this.reflector.getAllAndOverride<boolean>(APPROVED_PARTNER_KEY, targets);

    if (!required?.length && !needsApproval) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('로그인이 필요합니다.');
    }

    if (required?.length && !required.some((role) => user.roles.includes(role))) {
      throw new ForbiddenException('이 기능을 사용할 권한이 없습니다.');
    }

    if (needsApproval && !user.partnerApproved) {
      throw new ForbiddenException(
        '파트너 승인이 완료된 후에 사용할 수 있습니다. 심사 결과는 알림으로 알려드립니다.',
      );
    }

    return true;
  }
}
