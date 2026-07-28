import { cn } from '@/lib/utils';

/**
 * 로딩 스피너.
 *
 * 화면 전체를 기다리게 할 때는 쓰지 않는다 — 목록·상세의 대기 표현은
 * Skeleton 이 맡는다. 스피너는 "버튼을 눌렀고 지금 처리 중" 처럼
 * **사용자의 행동에 대한 즉각 반응**에만 쓴다.
 */
export function Spinner({
  className,
  size = 'md',
  label = '불러오는 중',
}: {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}) {
  const dimension = size === 'sm' ? 'h-4 w-4' : size === 'lg' ? 'h-8 w-8' : 'h-5 w-5';

  return (
    <span role="status" aria-live="polite" className={cn('inline-flex', className)}>
      <svg
        className={cn('animate-spin', dimension)}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <path
          d="M22 12a10 10 0 0 0-10-10"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  );
}
