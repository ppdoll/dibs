import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { Public } from './common/decorators/public.decorator';
import { PrismaService } from './prisma/prisma.service';

/**
 * 헬스체크.
 *
 * @Public() 이 반드시 필요하다 — 전역 JwtAuthGuard 는 기본이 "인증 필요"라, 이게 없으면
 * 헬스체크가 401 을 돌려준다. 그러면 Vercel 이나 업타임 모니터는 서비스가 죽은 것으로 읽는다.
 * (전역 prefix 에서도 제외되어 있어 경로는 /api/health 가 아니라 /health 다 — bootstrap.ts 참고.)
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check() {
    let db: 'ok' | 'down' = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'down';
    }

    return {
      status: db === 'ok' ? 'ok' : 'degraded',
      db,
      timestamp: new Date().toISOString(),
    };
  }
}
