import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

/**
 * 로컬 개발용 진입점. Vercel 배포 시에는 api/index.ts 핸들러가 대신 쓰인다.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await configureApp(app);

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);

  // eslint-disable-next-line no-console
  console.log(`Dibs API listening on http://localhost:${port}`);
}

void bootstrap();
