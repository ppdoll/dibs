import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Logger,
  OnModuleInit,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ApiExcludeController, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsEmail, MaxLength } from 'class-validator';

import { Public } from '../common/decorators/public.decorator';
import type { JwtPayload } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';

export class DevTokenDto {
  @IsEmail()
  @MaxLength(255)
  email!: string;
}

/**
 * 개발 전용 토큰 발급. **운영에서는 존재 자체가 열리지 않는다.**
 *
 * 왜 필요한가: 로그인 수단이 구글 하나뿐이라(D-09), 시드로 만든 데모 계정으로 화면을 눌러 보려면
 * Google Cloud 프로젝트를 먼저 만들고 OAuth 클라이언트와 리디렉션 URI 를 등록해야 한다.
 * 화면 하나 확인하려고 치르기엔 큰 비용이라, 로컬에서만 열리는 우회로를 둔다.
 *
 * 안전장치는 세 겹이다.
 *   1. NODE_ENV === 'production' 이면 부팅 시점에 라우트를 등록하되 항상 403 을 던진다.
 *      (조건부로 컨트롤러를 빼는 것보다, 켜져 있는지 로그로 확인되는 편이 낫다.)
 *   2. 이미 **존재하는** 계정에만 발급한다. 새 계정을 만들지 않는다 — 만들 수 있으면
 *      운영에 실수로 켜졌을 때 임의 계정 생성기가 된다.
 *   3. 부팅 시 경고 로그를 남긴다. 켜져 있다는 사실이 조용히 묻히지 않게.
 *
 * 실서비스 전에는 이 파일을 지우거나 AuthModule 에서 빼는 것을 권한다.
 */
@ApiTags('auth')
@ApiExcludeController()
@Controller('auth')
export class DevTokenController implements OnModuleInit {
  private readonly logger = new Logger(DevTokenController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private get isProduction(): boolean {
    return this.config.get<string>('NODE_ENV') === 'production';
  }

  onModuleInit(): void {
    if (this.isProduction) return;

    this.logger.warn(
      '개발용 토큰 엔드포인트가 열려 있습니다 — POST /api/auth/dev-token. 운영 배포 전에 제거하세요.',
    );
  }

  @Public()
  @Post('dev-token')
  @ApiOperation({ summary: '[개발 전용] 이메일로 액세스 토큰 발급' })
  async issue(@Body() dto: DevTokenDto): Promise<{ accessToken: string; userId: string }> {
    if (this.isProduction) {
      throw new ForbiddenException('운영 환경에서는 사용할 수 없습니다.');
    }

    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true, tokenVersion: true, deletedAt: true, displayName: true, roles: true },
    });

    if (!user || user.deletedAt) {
      throw new BadRequestException(
        `${dto.email} 계정을 찾을 수 없습니다. 먼저 시드를 실행하세요: pnpm --filter @dibs/api db:seed`,
      );
    }

    const payload: JwtPayload = { sub: user.id, tv: user.tokenVersion };
    const accessToken = await this.jwt.signAsync(payload);

    this.logger.warn(`[개발] ${user.displayName}(${dto.email}) 토큰 발급 — 역할 ${user.roles.join(',')}`);

    return { accessToken, userId: user.id };
  }
}
