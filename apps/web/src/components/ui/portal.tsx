'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * body 끝으로 렌더를 옮긴다.
 *
 * 모달을 제자리에 그리면 부모의 `overflow: hidden` 이나 `transform` 에
 * 잘려 나간다. 특히 상세 화면의 sticky 하단 CTA 와 겹치면 z-index 싸움이
 * 시작되는데, 포털로 빼면 그 싸움 자체가 없어진다.
 */
export function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);

  // 서버에는 document 가 없다. 마운트 이후에만 그린다.
  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  if (!mounted || typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}

/**
 * 모달이 열린 동안 뒤 화면 스크롤을 막는다.
 *
 * iOS 사파리는 body 를 fixed 로 만들지 않으면 뒤가 계속 스크롤된다.
 * 그런데 fixed 로 바꾸면 스크롤 위치가 맨 위로 튀므로, 닫을 때 되돌려 준다.
 */
export function useLockBodyScroll(locked: boolean): void {
  useEffect(() => {
    if (!locked) return;

    const { body } = document;
    const scrollY = window.scrollY;
    const previous = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: body.style.overflow,
    };

    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';
    body.style.overflow = 'hidden';

    return () => {
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.width = previous.width;
      body.style.overflow = previous.overflow;
      window.scrollTo(0, scrollY);
    };
  }, [locked]);
}

/** ESC 로 닫기. 열려 있을 때만 듣는다. */
export function useEscapeKey(active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!active) return;

    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onEscape();
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [active, onEscape]);
}
