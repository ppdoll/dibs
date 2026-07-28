import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import type { SignupIntent } from './dto/auth.dto';

/**
 * 구글 OAuth 의 `state` 파라미터를 **서명해서** 왕복시킨다.
 *
 * 왜 직접 만드는가: passport-oauth2 의 `state: true` 는 state 를 **세션에 저장**한다.
 * 우리는 서버리스라 세션이 없고(PassportModule 도 session:false), 그 상태로 켜면
 * 로그인 시작 요청이 그대로 500 이 난다 —
 *   "OAuth 2.0 authentication requires session support when using state."
 * 세션 스토어를 붙이면 되지만, 그러려면 Redis 같은 외부 저장소가 하나 더 생긴다.
 * 로그인 한 번을 위해 인프라를 늘리는 건 과하다.
 *
 * 그래서 state 를 **짧게 만료되는 JWT** 로 만든다. 세션이 없어도
 *   - 우리가 발급한 state 인지 (서명)
 *   - 오래된 것을 재사용하는지 (만료)
 * 를 콜백에서 확인할 수 있다. state 의 존재 이유인 CSRF 방어가 그대로 유지된다.
 *
 * 담는 내용은 intent(일반/파트너)와 redirect(로그인 후 갈 내부 경로)뿐이다.
 * 민감한 값은 넣지 않는다 — state 는 구글을 거쳐 브라우저 주소창에 노출된다.
 */
export interface OAuthStatePayload {
  intent?: SignupIntent;
  redirect?: string;
}

/** 로그인 시작 → 콜백까지 걸리는 시간. 사람이 구글 동의 화면을 넘기는 데 충분하다. */
const STATE_TTL = '10m';

@Injectable()
export class OAuthStateService {
  private readonly logger = new Logger(OAuthStateService.name);

  constructor(private readonly jwt: JwtService) {}

  sign(payload: OAuthStatePayload): string {
    return this.jwt.sign(
      { i: payload.intent, r: payload.redirect },
      { expiresIn: STATE_TTL },
    );
  }

  /**
   * 콜백에서 돌려받은 state 를 검증한다.
   *
   * 실패해도 예외를 던지지 않고 빈 값을 돌려준다. state 가 깨졌다는 건 의도(파트너로
   * 가입하려던 것)와 목적지를 잃었다는 뜻이지, 구글 인증 자체가 실패한 건 아니다.
   * 로그인은 성사시키고 기본값(일반 가입 · 홈으로)으로 진행한다 — 사용자를 오류 화면에
   * 세우는 것보다 낫다. 대신 로그는 남긴다.
   */
  verify(raw: unknown): OAuthStatePayload {
    if (typeof raw !== 'string' || raw.length === 0) return {};

    try {
      const claims = this.jwt.verify<{ i?: unknown; r?: unknown }>(raw);

      return {
        intent: claims.i === 'PARTNER' || claims.i === 'USER' ? claims.i : undefined,
        redirect: typeof claims.r === 'string' ? claims.r : undefined,
      };
    } catch (err) {
      // 만료(사용자가 동의 화면을 10분 넘게 열어둠)와 위조를 구분하지 않는다.
      // 어느 쪽이든 이 state 는 못 믿고, 처리 방식도 같다.
      this.logger.warn(
        `구글 state 검증 실패 — 기본값으로 진행합니다. (${err instanceof Error ? err.message : 'unknown'})`,
      );
      return {};
    }
  }
}
