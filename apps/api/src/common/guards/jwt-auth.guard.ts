import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * 전역 인증 가드. 기본이 "인증 필요"이고 @Public()만 열린다.
 *
 * 화이트리스트가 아니라 블랙리스트로 갔다면, 새 컨트롤러를 추가할 때마다
 * 가드를 붙이는 걸 잊어 조용히 열려버렸을 것이다. 실수의 방향을
 * "막힘"으로 기울여 둔다.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      // 공개 엔드포인트라도 토큰이 있으면 해석해 둔다. 로그인 상태에 따라
      // 다르게 보여줄 게 있어도(예: 내가 이미 신청했는지) 재요청이 필요 없다.
      void this.tryAttachUser(context);
      return true;
    }

    return super.canActivate(context);
  }

  /** 실패해도 무시한다. 공개 경로에서 토큰이 낡았다고 막을 이유가 없다. */
  private async tryAttachUser(context: ExecutionContext): Promise<void> {
    try {
      await super.canActivate(context);
    } catch {
      /* 익명으로 계속 진행한다 */
    }
  }
}
