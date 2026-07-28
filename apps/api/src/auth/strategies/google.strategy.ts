import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy, type VerifyCallback } from 'passport-google-oauth20';

/** 구글에서 받아 오는 신원. 우리가 실제로 쓰는 것만 추린다. */
export interface GoogleIdentity {
  googleSub: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string;
  avatarUrl: string | null;
  raw: unknown;
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService) {
    super({
      clientID: config.getOrThrow<string>('GOOGLE_CLIENT_ID'),
      clientSecret: config.getOrThrow<string>('GOOGLE_CLIENT_SECRET'),
      callbackURL: config.getOrThrow<string>('GOOGLE_CALLBACK_URL'),
      scope: ['email', 'profile'],
      passReqToCallback: false,
      // ★ `state: true` 를 쓰면 안 된다.
      //
      // 그 옵션은 passport-oauth2 가 state 를 **세션에 저장**하게 만든다. 우리는
      // 서버리스라 세션이 없고(PassportModule 도 session:false), 켜는 순간 로그인
      // 시작 요청이 그대로 500 이 난다:
      //   "OAuth 2.0 authentication requires session support when using state."
      // 자격증명이 올바르더라도 100% 실패하므로, 설정 문제로 오인하기 쉽다.
      //
      // 대신 GoogleAuthGuard 가 요청마다 **서명된 state**(짧게 만료되는 JWT)를
      // authenticate 옵션으로 넘긴다. 세션 없이도 CSRF 방어가 유지된다.
      // 자세한 건 auth/oauth-state.service.ts 를 보라.
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): void {
    const primary = profile.emails?.[0];

    const identity: GoogleIdentity = {
      googleSub: profile.id,
      email: primary?.value ?? null,
      // passport-google-oauth20의 타입에는 verified가 없지만 실제 페이로드에는 온다.
      emailVerified: (primary as { verified?: boolean } | undefined)?.verified === true,
      displayName: profile.displayName?.trim() || primary?.value?.split('@')[0] || '이용자',
      avatarUrl: profile.photos?.[0]?.value ?? null,
      raw: profile._json,
    };

    done(null, identity);
  }
}
