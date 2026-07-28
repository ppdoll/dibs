'use client';

import { useEffect, useRef } from 'react';

import { Button, Spinner } from '@/components/ui';

/**
 * 무한 스크롤의 바닥 감지기.
 *
 * IntersectionObserver 를 쓰는 이유: scroll 이벤트로 계산하면 매 프레임 레이아웃을
 * 읽게 되어 목록이 길어질수록 끊긴다. rootMargin 을 400px 로 두어 화면에 닿기
 * **전에** 다음 장을 미리 받는다 — 사용자가 스피너를 보는 시간이 거의 없어진다.
 *
 * 버튼도 함께 둔다. 관찰자가 동작하지 않는 환경(스크롤 컨테이너가 이상하거나
 * 자동 로드가 꺼진 접근성 설정)에서도 다음 장을 볼 수 있어야 한다.
 */
export function InfiniteSentinel({
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  endMessage = '마지막이에요',
}: {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  endMessage?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || !hasNextPage || isFetchingNextPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
      },
      { rootMargin: '400px 0px' },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, onLoadMore]);

  if (!hasNextPage) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{endMessage}</p>;
  }

  return (
    <div ref={ref} className="flex justify-center py-6">
      {isFetchingNextPage ? (
        <Spinner size="md" />
      ) : (
        <Button variant="outline" onClick={onLoadMore}>
          더 보기
        </Button>
      )}
    </div>
  );
}
