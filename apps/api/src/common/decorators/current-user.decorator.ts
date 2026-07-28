import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import type { AuthenticatedUser } from '../types/authenticated-user';

/**
 * 요청 주체를 꺼낸다.
 *
 * @Public() 엔드포인트에서는 undefined일 수 있으므로, 그런 자리에서는
 * `AuthenticatedUser | undefined`로 받아야 한다. 인증이 걸린 곳에서는
 * 가드가 이미 걸렀으므로 항상 존재한다.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser | undefined => {
    const request = ctx.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    return request.user;
  },
);
