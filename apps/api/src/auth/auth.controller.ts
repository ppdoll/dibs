import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiExcludeEndpoint,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { AuthService } from './auth.service';
import {
  GoogleLoginQueryDto,
  MeResponseDto,
  SubmitPartnerApplicationDto,
} from './dto/auth.dto';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { GoogleConfiguredGuard } from './guards/google-configured.guard';
import { OAuthStateService } from './oauth-state.service';
import type { GoogleIdentity } from './strategies/google.strategy';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly state: OAuthStateService,
  ) {}

  /**
   * 구글 로그인 시작. 브라우저를 구글로 넘긴다.
   *
   * intent(일반/파트너)와 redirect를 state에 실어 왕복시킨다 —
   * 콜백에서 원래 의도를 알아야 하는데 세션이 없기 때문이다(서버리스).
   */
  @Public()
  @Get('google')
  @ApiOperation({ summary: '구글 로그인 시작' })
  @UseGuards(GoogleConfiguredGuard, GoogleAuthGuard)
  googleLogin(@Query() _query: GoogleLoginQueryDto): void {
    // passport가 리다이렉트를 처리한다. 이 본문은 실행되지 않는다.
  }

  @Public()
  @Get('google/callback')
  @ApiExcludeEndpoint()
  @UseGuards(GoogleConfiguredGuard, AuthGuard('google'))
  async googleCallback(
    @Req() req: Request & { user: GoogleIdentity },
    @Res() res: Response,
  ): Promise<void> {
    // 서명·만료를 검증한다. 깨졌으면 빈 값이 와서 기본값(일반 가입 · 홈)으로 진행한다.
    const state = this.state.verify(req.query.state);

    const { accessToken } = await this.auth.loginWithGoogle(req.user, state.intent);

    // 토큰을 쿼리로 넘긴다. 서버리스라 세션이 없고, 프론트가 받아서 즉시
    // 저장한 뒤 URL을 지운다. (프론트 /auth/callback 참고)
    res.redirect(this.auth.buildRedirectUrl(accessToken, state.redirect));
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: '내 정보' })
  @ApiOkResponse({ type: MeResponseDto })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.getMe(user.id);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: '로그아웃 (모든 기기)' })
  logout(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    return this.auth.logoutEverywhere(user.id);
  }

  @Post('partner-application')
  @ApiBearerAuth()
  @ApiOperation({ summary: '파트너 신청서 제출 — 운영자 승인 후 활동 가능' })
  submitPartnerApplication(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubmitPartnerApplicationDto,
  ) {
    return this.auth.submitPartnerApplication(user.id, dto);
  }
}
