'use client';

import { useCallback, useMemo, useState } from 'react';

/**
 * 커서 페이지네이션 상태.
 *
 * 서버는 `nextCursor` 하나만 준다 — 앞으로만 갈 수 있다는 뜻이다. 그런데 심사 큐는
 * "한 장 넘겼다가 되돌아오기"가 잦은 화면이라, 지나온 커서를 **스택으로 쌓아** 뒤로가기를
 * 만든다. offset 으로 바꾸지 않는 이유는 목록이 계속 늘어나기 때문이다(중복·누락이 생긴다).
 *
 * 필터가 바뀌면 반드시 `reset()` 해야 한다. 안 그러면 A 필터의 커서로 B 목록을 읽는다.
 */
export interface CursorState {
  /** 지금 페이지를 읽을 때 서버에 보낼 커서. 첫 장이면 undefined. */
  cursor: string | undefined;
  /** 1부터 세는 페이지 번호. 표시용. */
  page: number;
  canPrev: boolean;
  next: (nextCursor: string | null) => void;
  prev: () => void;
  reset: () => void;
}

export function useCursor(): CursorState {
  // 첫 칸은 "커서 없음"이다. 스택의 마지막이 곧 현재 페이지의 커서다.
  const [stack, setStack] = useState<Array<string | null>>([null]);

  const next = useCallback((nextCursor: string | null) => {
    if (!nextCursor) return;
    setStack((prev) => [...prev, nextCursor]);
  }, []);

  const prev = useCallback(() => {
    setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  const reset = useCallback(() => setStack([null]), []);

  return useMemo(() => {
    const top = stack[stack.length - 1] ?? null;
    return {
      cursor: top ?? undefined,
      page: stack.length,
      canPrev: stack.length > 1,
      next,
      prev,
      reset,
    };
  }, [stack, next, prev, reset]);
}

/**
 * 필터 상태 + 커서를 한 쌍으로 묶는다.
 *
 * 필터를 바꾸는 모든 경로가 커서를 리셋하도록 강제하는 게 목적이다 —
 * 화면마다 손으로 `reset()` 을 부르면 언젠가 한 군데를 빠뜨린다.
 */
export function useFilters<T extends Record<string, unknown>>(
  initial: T,
): {
  filters: T;
  setFilter: <K extends keyof T>(key: K, value: T[K]) => void;
  setFilters: (patch: Partial<T>) => void;
  resetFilters: () => void;
  cursor: CursorState;
} {
  const [filters, setState] = useState<T>(initial);
  const cursor = useCursor();

  const setFilters = useCallback(
    (patch: Partial<T>) => {
      setState((prev) => ({ ...prev, ...patch }));
      cursor.reset();
    },
    [cursor],
  );

  const setFilter = useCallback(
    <K extends keyof T>(key: K, value: T[K]) => {
      setState((prev) => ({ ...prev, [key]: value }));
      cursor.reset();
    },
    [cursor],
  );

  const resetFilters = useCallback(() => {
    setState(initial);
    cursor.reset();
    // initial 은 호출부에서 리터럴로 넘기는 값이라 참조가 매번 바뀐다.
    // 의존성에 넣으면 매 렌더 새 콜백이 되므로 일부러 뺀다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor]);

  return { filters, setFilter, setFilters, resetFilters, cursor };
}
