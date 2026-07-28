import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import express, { Express } from 'express';
import helmet from 'helmet';

import { AppModule } from './app.module';

/**
 * 환경변수를 읽되 **빈 문자열도 미설정으로 취급**한다.
 *
 * `??` 를 쓰면 안 된다. .env 에 `CORS_ORIGINS=""` 처럼 키만 있고 값이 빈 경우가 흔한데
 * (우리 .env.example 이 정확히 그렇다), `??` 는 null/undefined 만 걸러내므로 빈 문자열이
 * 그대로 통과한다. 그러면 `"".split(',').filter(Boolean)` 이 **빈 배열**이 되고,
 * 허용 출처가 하나도 없어져 프론트의 모든 요청이 CORS 로 막힌다.
 * 브라우저에는 `net::ERR_FAILED` 로만 보여서 원인을 찾기가 아주 어렵다.
 */
function envOr(key: string, fallback: string): string {
  const raw = process.env[key];
  return raw !== undefined && raw.trim() !== '' ? raw : fallback;
}

/** 허용 출처 목록. CORS_ORIGINS(쉼표 구분) → WEB_APP_URL → 로컬 기본값 순으로 떨어진다. */
function resolveCorsOrigins(): string[] {
  const raw = envOr('CORS_ORIGINS', envOr('WEB_APP_URL', 'http://localhost:3000'));

  const origins = raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  // 여기까지 와서 비면 설정이 잘못된 것이다. 전부 막아 조용히 죽느니 로컬 기본값이라도 남긴다.
  return origins.length > 0 ? origins : ['http://localhost:3000'];
}

/**
 * Nest 앱에 공통 설정을 적용한다.
 * 로컬 개발 서버(main.ts)와 Vercel 서버리스 핸들러(api/index.ts)가 함께 쓴다.
 */
export async function configureApp(app: INestApplication): Promise<void> {
  app.use(helmet());

  app.enableCors({
    origin: resolveCorsOrigins(),
    credentials: true,
  });

  app.setGlobalPrefix('api', { exclude: ['health'] });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  if (process.env.SWAGGER_ENABLED !== 'false') {
    const config = new DocumentBuilder()
      .setTitle('Dibs API')
      .setDescription('선착순/입찰형 예약 플랫폼 API')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
  }
}

/**
 * Express 인스턴스 위에 Nest 앱을 올려 반환한다.
 *
 * 서버리스에서는 이 결과를 모듈 스코프에 캐시해 콜드스타트를 한 번만 치르게 한다.
 * `listen()`을 호출하지 않고 `init()`만 하는 것이 핵심 — Vercel이 소켓을 관리한다.
 */
export async function createExpressApp(): Promise<Express> {
  const expressApp = express();
  const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp), {
    logger: ['error', 'warn', 'log'],
  });

  await configureApp(app);
  await app.init();

  return expressApp;
}
