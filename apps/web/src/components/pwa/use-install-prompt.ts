'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * 브라우저가 설치 조건을 만족했을 때 던지는 이벤트. 표준 타입에 아직 없어서 직접 적는다.
 * 크롬·엣지 계열만 발생시킨다 — 사파리는 이 이벤트가 없다.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallState =
  /** 아직 판단 전(서버 렌더 직후) */
  | 'unknown'
  /** 이미 앱으로 실행 중 */
  | 'installed'
  /** 버튼을 눌러 바로 설치할 수 있다 */
  | 'ready'
  /** 설치는 되지만 브라우저가 버튼을 안 준다 — 사파리 계열. 수동 안내가 필요하다 */
  | 'manual';

/**
 * 설치 프롬프트를 붙잡아 두었다가 우리 버튼으로 띄운다.
 *
 * ★ 왜 필요한가 — 크롬은 설치 조건을 만족해도 **주소창 구석의 작은 아이콘**만 띄운다.
 *   모르는 사람은 평생 못 찾는다. iOS 는 아예 이벤트조차 없어서 공유 시트를 직접 열어야 한다.
 *   매니페스트와 서비스 워커를 다 갖춰 놓고도 "PWA 가 안 된다"고 느끼는 이유가 대개 이것이다.
 *
 * ★ 이벤트는 **한 번만, 그것도 아주 이르게** 온다. 리스너를 늦게 붙이면 놓친다.
 *   그래서 화면이 아니라 훅에서 붙잡아 두고, 버튼은 그 뒤에 렌더돼도 되게 만든다.
 */
export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [state, setState] = useState<InstallState>('unknown');

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      // iOS 사파리는 display-mode 대신 이 비표준 속성을 쓴다.
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

    if (standalone) {
      setState('installed');
      return;
    }

    // 이벤트가 안 오는 브라우저(사파리 등)를 위한 기본값. 오면 아래에서 'ready' 로 올라간다.
    setState('manual');

    const onBeforeInstall = (event: Event) => {
      // 막지 않으면 크롬이 자체 미니 배너를 띄우고 이벤트를 소모한다.
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
      setState('ready');
    };

    const onInstalled = () => {
      setDeferred(null);
      setState('installed');
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    if (!deferred) return 'unavailable';

    await deferred.prompt();
    const { outcome } = await deferred.userChoice;

    // 프롬프트는 재사용할 수 없다. 거절당했으면 이번 세션에서는 버튼을 내린다.
    setDeferred(null);
    setState(outcome === 'accepted' ? 'installed' : 'manual');

    return outcome;
  }, [deferred]);

  return { state, install, canPrompt: deferred !== null };
}

/** iOS 사파리인가 — 수동 설치 안내 문구를 갈라 써야 한다. */
export function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;

  const ua = navigator.userAgent;
  // iPadOS 13+ 는 UA 에 iPad 대신 Macintosh 를 쓴다. 터치 지원 여부로 갈라낸다.
  const ios = /iPhone|iPod|iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

  return ios;
}
