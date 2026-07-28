import { CanActivate, Injectable, ServiceUnavailableException } from '@nestjs/common';

import { isGoogleAuthConfigured } from '../../config/env.schema';

/**
 * 구글 자격증명이 없을 때 /auth/google 을 **읽을 수 있는 오류**로 닫는다.
 *
 * 이 가드가 없으면 passport 가 "Unknown authentication strategy google" 을 던져
 * 정체불명의 500 이 뜬다. 설정이 빠진 것과 코드가 깨진 것을 구분할 수 없는 오류는
 * 남의 시간을 가장 많이 잡아먹는 종류라, 무엇을 해야 하는지까지 적어서 돌려준다.
 *
 * AuthGuard('google') 보다 **먼저** 걸려야 의미가 있다 — @UseGuards 는 나열 순서대로 돈다.
 */
@Injectable()
export class GoogleConfiguredGuard implements CanActivate {
  canActivate(): boolean {
    if (isGoogleAuthConfigured()) return true;

    throw new ServiceUnavailableException({
      code: 'GOOGLE_AUTH_NOT_CONFIGURED',
      message:
        '구글 로그인이 설정되지 않았습니다. apps/api/.env 에 GOOGLE_CLIENT_ID 와 ' +
        'GOOGLE_CLIENT_SECRET 을 채우고 API 를 다시 시작하세요.',
      hint: '로컬에서 화면만 확인하려면 POST /api/auth/dev-token 으로 시드 계정 토큰을 받으세요.',
    });
  }
}
