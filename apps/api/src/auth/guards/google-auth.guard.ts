import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';

import { OAuthStateService } from '../oauth-state.service';
import { SIGNUP_INTENTS, type SignupIntent } from '../dto/auth.dto';

/**
 * 구글 로그인 시작 가드.
 *
 * 기본 AuthGuard('google') 대신 이걸 쓰는 이유는 **state 를 요청마다 만들어 넘기기**
 * 위해서다. GoogleStrategy 에 `state: true` 를 주면 passport 가 세션에 저장하려 들고,
 * 세션이 없는 서버리스에서는 그 자리에서 500 이 난다. 여기서 서명된 state 를
 * authenticate 옵션으로 직접 넘기면 세션 없이도 왕복이 된다.
 *
 * 콜백은 이 가드를 쓰지 않는다 — 돌아온 state 는 컨트롤러가 OAuthStateService 로 검증한다.
 */
@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  constructor(private readonly state: OAuthStateService) {
    super();
  }

  override getAuthenticateOptions(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();

    const rawIntent = request.query.intent;
    const intent = SIGNUP_INTENTS.includes(rawIntent as SignupIntent)
      ? (rawIntent as SignupIntent)
      : undefined;

    const rawRedirect = request.query.redirect;
    // 열린 리다이렉트 방지. 내부 경로만 싣는다 — `//evil.com` 은 스킴 없는 절대 URL 이다.
    const redirect =
      typeof rawRedirect === 'string' && rawRedirect.startsWith('/') && !rawRedirect.startsWith('//')
        ? rawRedirect.slice(0, 300)
        : undefined;

    return { state: this.state.sign({ intent, redirect }) };
  }
}
