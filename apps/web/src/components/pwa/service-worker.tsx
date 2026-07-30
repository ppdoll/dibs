'use client';

import { useEffect } from 'react';

/**
 * 서비스 워커 등록.
 *
 * 개발 모드에서는 등록하지 않는다 — HMR 이 쓰는 `/_next/static/**` 을 워커가 가로채면
 * 코드를 고쳐도 화면이 안 바뀌는, 원인 찾기 아주 어려운 상태가 된다.
 *
 * ★ 탈출구: 주소에 `?sw=off` 를 붙여 한 번 열면 등록을 해제하고 캐시를 전부 비운다.
 *   워커가 뭔가 잘못 붙잡고 있을 때 사용자에게 "캐시 지우세요" 대신 링크 하나를 줄 수 있다.
 *   개발 모드에서도 이 정리는 돈다 — 예전에 운영에서 받은 워커가 로컬 3000 포트에
 *   남아 있는 경우가 실제로 생긴다.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const disable = new URLSearchParams(window.location.search).get('sw') === 'off';

    if (disable || process.env.NODE_ENV !== 'production') {
      void unregisterAll(disable);
      return;
    }

    // 등록 실패는 조용히 넘긴다. 워커는 어디까지나 부가 기능이고,
    // 여기서 던지면 앱 전체가 죽는다.
    void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
  }, []);

  return null;
}

async function unregisterAll(clearCaches: boolean): Promise<void> {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((r) => r.unregister()));

    if (clearCaches && 'caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    /* 정리에 실패해도 앱 동작에는 영향이 없다 */
  }
}
