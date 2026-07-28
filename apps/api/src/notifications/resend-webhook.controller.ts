import { Controller, HttpCode, HttpStatus, Logger, Post, Req } from '@nestjs/common';
import { ApiExcludeController, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { Public } from '../common/decorators/public.decorator';
import { EmailWebhookService } from './email-webhook.service';

/** Nest 를 `rawBody: true` 로 만들면 요청 객체에 붙는 원문 버퍼. */
type RawBodyRequest = Request & { rawBody?: Buffer };

/**
 * Resend 배달 웹훅. (IC-43)
 *
 * `@Public()` 이지만 무방비가 아니다 — 서비스가 Svix 서명(HMAC-SHA256)을 검증하고
 * 실패하면 401 이다. 인증 없이 열린 유일한 쓰기 경로라 검증 실패는 예외 없이 거부한다.
 *
 * 서명 대상은 **원문 바이트**여야 한다. `req.rawBody` 는 Nest 를 `rawBody: true` 로 만들었을 때만
 * 채워지므로, 없으면 파싱된 객체를 다시 직렬화해서 시도한다. 이 대체 경로는 보안을 낮추지 않는다 —
 * 재직렬화 결과가 원문과 한 바이트라도 다르면 HMAC 이 어긋나 **거부**되기 때문이다.
 * 다만 한글 제목처럼 이스케이프 표현이 갈릴 수 있는 페이로드에서는 정상 웹훅도 401 이 되므로,
 * 운영에서는 부트스트랩에서 `rawBody: true` 를 켜는 편이 확실하다.
 */
@ApiTags('webhooks')
@ApiExcludeController()
@Public()
@Controller('webhooks/resend')
export class ResendWebhookController {
  private readonly logger = new Logger(ResendWebhookController.name);

  constructor(private readonly webhook: EmailWebhookService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend 배달 이벤트 수신' })
  async handle(@Req() req: RawBodyRequest) {
    const raw = req.rawBody?.toString('utf8') ?? this.reserialize(req.body);

    return this.webhook.handle(
      {
        id: header(req, 'svix-id'),
        timestamp: header(req, 'svix-timestamp'),
        signature: header(req, 'svix-signature'),
      },
      raw,
    );
  }

  private reserialize(body: unknown): string {
    this.logger.warn(
      'req.rawBody 가 없어 파싱된 본문을 재직렬화해 서명을 검증합니다. ' +
        'NestFactory.create 에 rawBody: true 를 켜 주세요.',
    );
    return typeof body === 'string' ? body : JSON.stringify(body ?? {});
  }
}

/** 헤더는 배열로 올 수 있다(중복 헤더). 첫 값만 쓴다. */
function header(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
