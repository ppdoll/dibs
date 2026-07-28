import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

/**
 * Resend 어댑터. (D-10, D-11)
 *
 * 규칙 두 개만 지킨다.
 *
 * 1. **절대 던지지 않는다.** 이 메서드는 크론 배치 루프 안에서 불린다.
 *    한 통이 실패했다고 예외가 올라가면 같은 배치의 나머지 수십 통이 SENDING 으로 묶인 채
 *    리스가 풀릴 때까지 멈춘다. 실패는 값으로 돌려주고 호출부가 상태기계에 반영한다.
 * 2. **키가 없으면 비활성이다.** 개발 환경에는 RESEND_API_KEY 가 없다. 그때 던지면
 *    로컬에서 크론을 한 번도 못 돌려보고, 그러면 발송 상태기계는 프로덕션에서 처음 실행된다.
 */
export interface MailInput {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** EmailDelivery.id 계열 값. 같은 행을 재시도해도 프로바이더가 두 번 보내지 않게 한다. */
  idempotencyKey: string;
}

export type MailResult =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; retryable: boolean; code: string; message: string };

/**
 * SDK 표면을 구조적 타입으로 좁혀 잡는다.
 *
 * `emails.send` 의 두 번째 인자(idempotencyKey)는 resend 4.x 중간 버전에서 추가됐다.
 * 패키지 버전이 조금 낮으면 타입이 없어 컴파일이 깨지는데, 런타임에서는 그냥 무시되므로
 * 여기서 구조적으로 선언하고 캐스팅한다. 대신 응답 모양은 명시해서 결과 처리는 타입이 지킨다.
 */
interface ResendLike {
  emails: {
    send: (
      payload: {
        from: string;
        to: string[];
        subject: string;
        text: string;
        html: string;
      },
      options?: { idempotencyKey?: string },
    ) => Promise<{
      data: { id: string } | null;
      error: { name?: string; message?: string } | null;
    }>;
  };
}

/** 프로바이더 쪽 일시 장애. 다시 때리면 성공할 수 있다. */
const RETRYABLE_ERROR_NAMES = new Set([
  'rate_limit_exceeded',
  'daily_quota_exceeded',
  'internal_server_error',
  'application_error',
]);

@Injectable()
export class ResendMailer {
  private readonly logger = new Logger(ResendMailer.name);
  private readonly client: ResendLike | null;
  private readonly from: string;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('RESEND_API_KEY');
    this.from = config.get<string>('EMAIL_FROM') ?? 'Dibs <no-reply@dibs.example>';

    this.client = apiKey ? (new Resend(apiKey) as unknown as ResendLike) : null;

    if (!this.client) {
      this.logger.warn('RESEND_API_KEY 가 없어 이메일 발송이 비활성화되었습니다. 발송은 SKIPPED 로 기록됩니다.');
    }
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  async send(input: MailInput): Promise<MailResult> {
    const client = this.client;
    if (!client) {
      return { ok: false, retryable: false, code: 'RESEND_DISABLED', message: 'RESEND_API_KEY 미설정' };
    }

    try {
      const { data, error } = await client.emails.send(
        {
          from: this.from,
          to: [input.to],
          subject: input.subject,
          text: input.text,
          html: input.html,
        },
        { idempotencyKey: input.idempotencyKey },
      );

      if (error) {
        const code = error.name ?? 'unknown_error';
        return {
          ok: false,
          retryable: RETRYABLE_ERROR_NAMES.has(code),
          code,
          message: error.message ?? '',
        };
      }

      return { ok: true, providerMessageId: data?.id ?? null };
    } catch (cause) {
      // 네트워크 단절·타임아웃. 프로바이더가 받았는지 알 수 없지만 idempotencyKey 가 있으므로
      // 재시도해도 두 번 발송되지 않는다. 그래서 항상 retryable 이다.
      const message = cause instanceof Error ? cause.message : String(cause);
      this.logger.warn(`Resend 호출 실패(재시도 예정): ${message}`);
      return { ok: false, retryable: true, code: 'NETWORK_ERROR', message };
    }
  }
}
