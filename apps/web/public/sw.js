/*
 * Dibs 서비스 워커.
 *
 * ★ 이 파일의 설계 원칙은 "가능한 한 캐시하지 않는다" 이다.
 *
 *   이 서비스의 화면은 경쟁률·남은 자리·마감 시각처럼 **초 단위로 틀려지면 안 되는 값**으로
 *   차 있다. 흔한 PWA 예제처럼 stale-while-revalidate 를 전역에 걸면, 사용자는 이미 마감된
 *   이벤트에 신청 버튼을 누르게 된다. 오프라인 지원보다 그게 훨씬 큰 손해다.
 *
 *   그래서 손대는 대상을 둘로 못박았다:
 *     1. `/_next/static/**` — 파일명에 콘텐츠 해시가 박혀 있다. 내용이 바뀌면 이름이 바뀌므로
 *        캐시가 낡을 수가 없다. 유일하게 캐시 우선(cache-first)이 안전한 대상이다.
 *     2. 화면 이동(navigate) — 네트워크 우선. 실패했을 때만 오프라인 안내를 보여준다.
 *
 *   그 외 모든 요청은 **respondWith 를 부르지 않는다.** 브라우저가 평소대로 처리한다.
 *   API 는 애초에 다른 오리진(dibs-api.vercel.app)이라 여기까지 오지도 않지만,
 *   오리진 검사로 한 번 더 막는다.
 *
 * ★ 워커를 꺼야 한다면 — 주소창에 `?sw=off` 를 붙여 한 번 접속하면 등록이 해제되고
 *   캐시가 비워진다. (service-worker.tsx 에 구현돼 있다.)
 */

/** 캐시 이름의 접두사. 올리면 이전 캐시가 activate 에서 전부 지워진다. */
const VERSION = 'dibs-v1';
const STATIC_CACHE = `${VERSION}::static`;
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      // `cache: 'reload'` — 설치 시점에는 HTTP 캐시를 무시하고 원본을 받는다.
      await cache.add(new Request(OFFLINE_URL, { cache: 'reload' }));
      // 새 배포가 나가면 곧바로 넘겨받는다. 캐시 대상이 해시된 정적 파일뿐이라
      // 세션 중간에 교체돼도 낡은 것과 새것이 섞이지 않는다.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

/** 해시가 박힌 빌드 산출물. 한 번 받으면 다시 안 받는다. */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);

  // 부분 응답(206)이나 실패는 캐시에 넣지 않는다 — 깨진 조각이 영구히 남는다.
  if (response.ok && response.status === 200) {
    const cache = await caches.open(STATIC_CACHE);
    cache.put(request, response.clone());
  }

  return response;
}

/** 화면 이동. 네트워크가 먼저고, 죽었을 때만 오프라인 안내로 떨어진다. */
async function networkFirstNavigation(request) {
  try {
    return await fetch(request);
  } catch {
    const fallback = await caches.match(OFFLINE_URL);
    return (
      fallback ??
      new Response('오프라인입니다.', {
        status: 503,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    );
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // 다른 오리진(= API, 구글 로그인, 이미지 CDN)은 건드리지 않는다.
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  // 나머지는 손대지 않는다.
});
