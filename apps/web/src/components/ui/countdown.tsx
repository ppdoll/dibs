'use client';

import { useEffect, useState } from 'react';

import {
  countdownParts,
  countdownTickMs,
  formatCountdown,
  formatRemainingKo,
  type CountdownParts,
} from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * 마감까지 남은 시간.
 *
 * 서버 렌더에서 시각을 계산하면 하이드레이션 때 값이 어긋난다(그 사이에
 * 시간이 흐르므로). 그래서 첫 렌더는 서버·클라이언트가 똑같이 만들 수 있는
 * "정적 텍스트" 를 그리고, 마운트 후부터 초를 센다.
 *
 * 하루 이상 남았으면 30초에 한 번만 다시 그린다 — 1초마다 리렌더할 이유가
 * 없고, 목록에 카드가 20장 있으면 그 낭비가 눈에 띈다.
 */
export function useCountdown(target: string | Date | null | undefined): {
  parts: CountdownParts;
  /** 마운트 전에는 false. 이때는 초 단위 표시를 피한다. */
  live: boolean;
} {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = () => {
      if (cancelled) return;
      const current = new Date();
      setNow(current);
      timer = setTimeout(tick, countdownTickMs(countdownParts(target, current)));
    };

    tick();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [target]);

  return {
    parts: countdownParts(target, now ?? new Date(0)),
    live: now !== null,
  };
}

export function Countdown({
  target,
  className,
  /** 앞에 "마감까지" 를 붙일지 */
  prefix = false,
  /** 초 단위 대신 "3시간 12분" 처럼 부드럽게 */
  soft = false,
  /** 1시간 미만이면 빨갛게 */
  urgentHighlight = true,
}: {
  target: string | Date | null | undefined;
  className?: string;
  prefix?: boolean;
  soft?: boolean;
  urgentHighlight?: boolean;
}) {
  const { parts, live } = useCountdown(target);

  if (!target) return null;

  // 마운트 전에는 시계를 그리지 않는다. 서버와 값이 다를 수밖에 없다.
  if (!live) {
    return (
      <span className={cn('inline-block tabular-nums', className)} suppressHydrationWarning>
        {prefix ? '마감까지 ' : ''}—
      </span>
    );
  }

  if (parts.expired) {
    return (
      <span className={cn('text-muted-foreground', className)}>
        {prefix ? '신청이 마감되었습니다' : '마감'}
      </span>
    );
  }

  const now = new Date();
  const text = soft ? formatRemainingKo(target, now) : formatCountdown(target, now);

  return (
    <span
      className={cn(
        'tabular-nums',
        urgentHighlight && parts.urgent && 'font-bold text-primary',
        className,
      )}
      suppressHydrationWarning
    >
      {prefix ? '마감까지 ' : ''}
      {text}
    </span>
  );
}

/**
 * 예약금 입금 타이머. (D-05)
 *
 * 남은 시간이 곧 자격이라 초까지 보여준다. 만료되면 문구가 바뀌고,
 * onExpire 로 화면이 상태를 다시 읽게 한다 — 서버가 지연 만료(lazy expiry)를
 * 하므로 새로 조회해야 진짜 상태가 나온다.
 */
export function DepositCountdown({
  dueAt,
  onExpire,
  className,
}: {
  dueAt: string | Date | null | undefined;
  onExpire?: () => void;
  className?: string;
}) {
  const { parts, live } = useCountdown(dueAt);
  const [notified, setNotified] = useState(false);

  useEffect(() => {
    if (!live || !parts.expired || notified) return;
    setNotified(true);
    onExpire?.();
  }, [live, parts.expired, notified, onExpire]);

  if (!dueAt) return null;

  if (!live) {
    return <span className={cn('tabular-nums', className)} suppressHydrationWarning>—</span>;
  }

  if (parts.expired) {
    return <span className={cn('font-semibold text-destructive', className)}>입금 시간이 지났어요</span>;
  }

  return (
    <span className={cn('font-bold tabular-nums text-primary', className)} suppressHydrationWarning>
      {formatCountdown(dueAt, new Date())}
    </span>
  );
}
