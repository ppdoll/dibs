import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Express } from 'express';

import { createExpressApp } from '../src/bootstrap';

/**
 * Vercel 서버리스 진입점.
 *
 * 람다 인스턴스가 재사용되는 동안 Nest 앱을 모듈 스코프에 캐시해 부팅 비용을
 * 한 번만 치른다. 동시에 들어온 첫 요청들이 각자 부팅하지 않도록 Promise 자체를
 * 캐시한다(부팅 중복 방지).
 */
let cachedApp: Promise<Express> | undefined;

function getApp(): Promise<Express> {
  if (!cachedApp) {
    cachedApp = createExpressApp().catch((err) => {
      // 부팅에 실패하면 캐시를 비워 다음 요청이 다시 시도할 수 있게 한다.
      cachedApp = undefined;
      throw err;
    });
  }
  return cachedApp;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await getApp();
  return app(req as never, res as never);
}
