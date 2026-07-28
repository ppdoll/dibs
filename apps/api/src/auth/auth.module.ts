import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { isGoogleAuthConfigured } from '../config/env.schema';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DevTokenController } from './dev-token.controller';
import { OAuthStateService } from './oauth-state.service';
import { GoogleStrategy } from './strategies/google.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PrismaModule,
    PassportModule.register({ session: false }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        // jsonwebtoken 9의 타입은 expiresIn을 `${number}d` 같은 리터럴로 좁힌다.
        // 값은 환경변수라 런타임에만 알 수 있으므로 여기서 단언한다.
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN', '7d') as `${number}d` },
      }),
    }),
  ],
  // DevTokenController 는 로컬에서 구글 OAuth 없이 시드 계정으로 화면을 확인하기 위한 것이다.
  // 운영에서는 스스로 403 을 던진다. 실서비스 전에 이 줄을 지우면 라우트 자체가 사라진다.
  controllers: [AuthController, DevTokenController],
  // GoogleStrategy 를 **조건부로** 등록한다.
  //
  // 이 전략은 생성자에서 clientID 를 getOrThrow 로 읽는다. 자격증명이 없는데 등록하면
  // DI 단계에서 앱 전체가 부팅에 실패한다 — 구글 로그인 하나 때문에 API 가 통째로 안 뜬다.
  // 등록하지 않으면 /auth/google 만 닫히고(GoogleConfiguredGuard 가 503 으로 안내한다)
  // 나머지 160개 엔드포인트는 정상 동작한다.
  providers: [
    AuthService,
    OAuthStateService,
    JwtStrategy,
    ...(isGoogleAuthConfigured() ? [GoogleStrategy] : []),
  ],
  exports: [AuthService],
})
export class AuthModule {
  private readonly logger = new Logger(AuthModule.name);

  constructor() {
    if (!isGoogleAuthConfigured()) {
      this.logger.warn(
        '구글 자격증명이 없어 /api/auth/google 을 닫았습니다. ' +
          '로컬에서는 POST /api/auth/dev-token 으로 시드 계정에 로그인하세요.',
      );
    }
  }
}
