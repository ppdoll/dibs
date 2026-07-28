import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainValidationError } from '@dibs/shared';
import type { Request, Response } from 'express';

/**
 * 도메인 예외를 HTTP로 옮긴다.
 *
 * shared의 검증 규칙은 서버와 화면이 함께 쓴다. 서버에서 걸렸을 때도
 * 화면이 필드별로 표시할 수 있도록 issues 배열을 그대로 실어 보낸다.
 * 문구 대신 code로 분기하게 해서, 나중에 문구를 바꿔도 화면이 안 깨진다.
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, body } = this.translate(exception, request);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json(body);
  }

  private translate(exception: unknown, request: Request) {
    const base = { path: request.url, timestamp: new Date().toISOString() };

    if (exception instanceof DomainValidationError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        body: { ...base, statusCode: 400, error: 'DomainValidation', issues: exception.issues },
      };
    }

    if (exception instanceof HttpException) {
      const payload = exception.getResponse();
      return {
        status: exception.getStatus(),
        body: {
          ...base,
          statusCode: exception.getStatus(),
          ...(typeof payload === 'string' ? { message: payload } : payload),
        },
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.translatePrisma(exception, base);
    }

    // DB 에 아예 붙지 못한 경우. 이걸 일반 500 으로 흘려보내면 개발자가 처음 서버를 띄웠을 때
    // "요청을 처리하지 못했습니다"만 보고 원인을 못 찾는다 — 실제로는 Postgres 가 안 떠 있을 뿐이다.
    if (
      exception instanceof Prisma.PrismaClientInitializationError ||
      exception instanceof Prisma.PrismaClientRustPanicError
    ) {
      this.logger.error(`DB 연결 실패: ${(exception as Error).message.split('\n')[0]}`);
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        body: {
          ...base,
          statusCode: 503,
          error: 'DatabaseUnavailable',
          message: '데이터베이스에 연결할 수 없습니다.',
          hint: 'Postgres 가 떠 있는지, apps/api/.env 의 DATABASE_URL 이 맞는지 확인하세요. (docker compose up -d)',
        },
      };
    }

    // 여기까지 오면 우리가 예상 못 한 것이다. 내부 사정을 밖으로 흘리지 않는다.
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { ...base, statusCode: 500, error: 'InternalServerError', message: '요청을 처리하지 못했습니다.' },
    };
  }

  private translatePrisma(
    exception: Prisma.PrismaClientKnownRequestError,
    base: { path: string; timestamp: string },
  ) {
    switch (exception.code) {
      // 유니크 위반. 1인 1신청, 중복 slug 등이 여기로 온다.
      case 'P2002':
        return {
          status: HttpStatus.CONFLICT,
          body: { ...base, statusCode: 409, error: 'Conflict', message: '이미 존재하는 값입니다.' },
        };
      // FK 위반 — 존재하지 않는 대상을 가리켰다.
      case 'P2003':
        return {
          status: HttpStatus.BAD_REQUEST,
          body: { ...base, statusCode: 400, error: 'BadRequest', message: '참조 대상을 찾을 수 없습니다.' },
        };
      // CHECK 제약 위반. 001_constraints.sql의 불변식이 걸렸다는 뜻이라
      // 사실상 우리 쪽 버그다 — 로그로 남기되 사용자에겐 일반 문구를 준다.
      case 'P2004':
        this.logger.error(`DB 제약 위반: ${exception.message}`);
        return {
          status: HttpStatus.CONFLICT,
          body: { ...base, statusCode: 409, error: 'Conflict', message: '요청을 처리할 수 없는 상태입니다.' },
        };
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          body: { ...base, statusCode: 404, error: 'NotFound', message: '대상을 찾을 수 없습니다.' },
        };
      default:
        this.logger.error(`처리되지 않은 Prisma 오류 ${exception.code}: ${exception.message}`);
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          body: { ...base, statusCode: 500, error: 'InternalServerError', message: '요청을 처리하지 못했습니다.' },
        };
    }
  }
}
