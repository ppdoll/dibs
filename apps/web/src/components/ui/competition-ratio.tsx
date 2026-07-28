import { Users } from 'lucide-react';

import { formatCompetitionShort } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { CompetitionRatio } from '@/types/api';

/**
 * ★ D-07 — 기간 중 경쟁 정보를 보여주는 **유일한** 컴포넌트.
 *
 *   "정원 10명 · 신청 47명 (4.7:1)"
 *
 * 여기에 없는 것이 규칙이다: 남의 금액도, 내 순위도, 커트라인도, 순위표도
 * 그리지 않는다. 서버가 그 값을 보내지 않으므로 그릴 수도 없지만,
 * **화면이 그런 게 존재한다고 암시해서도 안 된다.**
 * "현재 15위" 같은 문구를 넣고 싶어지면 DECISIONS.md D-07 을 다시 읽을 것.
 *
 * ratio 가 null 이면 비공개다. 이때 applicantCount 를 대신 보여주면 안 된다 —
 * 서버가 0 으로 눌러 보내므로 "신청 0명" 이라는 거짓말이 된다.
 */
export function CompetitionRatioLine({
  competition,
  className,
  showIcon = true,
}: {
  competition: CompetitionRatio | null | undefined;
  className?: string;
  showIcon?: boolean;
}) {
  const hidden = !competition || competition.ratio === null;

  return (
    <p className={cn('flex items-center gap-1.5 text-sm text-muted-foreground', className)}>
      {showIcon ? <Users className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
      {hidden ? (
        <span>경쟁률 비공개</span>
      ) : (
        <span>
          정원 {competition.capacity}명 · 신청 {competition.applicantCount}명{' '}
          <span className="font-semibold text-foreground">({competition.display})</span>
        </span>
      )}
    </p>
  );
}

/** 카드 위에 얹는 짧은 형태. "4.7:1" */
export function CompetitionRatioBadge({
  competition,
  className,
}: {
  competition: CompetitionRatio | null | undefined;
  className?: string;
}) {
  if (!competition || competition.ratio === null) return null;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5',
        'text-xs font-bold tabular-nums text-primary',
        className,
      )}
      aria-label={`경쟁률 ${competition.display}`}
    >
      경쟁률 {formatCompetitionShort(competition)}
    </span>
  );
}

/**
 * 정원 대비 신청 수를 막대로. 경쟁률과 **같은 정보**를 눈으로 보여줄 뿐,
 * 새로운 정보를 만들지 않는다. 정원을 넘으면 100% 에서 멈춘다(D-03).
 */
export function CompetitionBar({
  competition,
  className,
}: {
  competition: CompetitionRatio | null | undefined;
  className?: string;
}) {
  if (!competition || competition.ratio === null) return null;

  const percent = Math.min(100, Math.round(competition.ratio * 100));

  return (
    <div
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}
      role="img"
      aria-label={`경쟁률 ${competition.display}`}
    >
      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
    </div>
  );
}
