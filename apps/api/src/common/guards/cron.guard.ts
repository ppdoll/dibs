import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

/**
 * 크론 엔드포인트를 보호한다.
 *
 * Vercel Cron은 CRON_SECRET 환경변수가 설정돼 있으면
 * `Authorization: Bearer <CRON_SECRET>` 헤더를 붙여 호출한다.
 * 이 가드가 없으면 디파짓 만료 스위퍼를 아무나 때릴 수 있다.
 */
@Injectable()
export class CronGuard implements CanActivate {
  private readonly logger = new Logger(CronGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const secret = process.env.CRON_SECRET;

    if (!secret) {
      // 시크릿을 안 걸어두면 엔드포인트가 무방비로 열린다. 열어주느니 막는다.
      this.logger.error('CRON_SECRET이 설정되지 않아 크론 요청을 거부합니다.');
      throw new UnauthorizedException();
    }

    const header = context.switchToHttp().getRequest<Request>().headers.authorization ?? '';
    const provided = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';

    if (!safeEqual(provided, secret)) {
      throw new UnauthorizedException();
    }

    return true;
  }
}

/** 길이 노출과 조기 반환을 피하기 위한 상수 시간 비교. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');

  // timingSafeEqual은 길이가 다르면 던진다. 길이 자체가 힌트가 되지 않도록
  // 같은 길이의 더미와 비교한 뒤 false를 돌려준다.
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufB, bufB);
    return false;
  }

  return timingSafeEqual(bufA, bufB);
}
