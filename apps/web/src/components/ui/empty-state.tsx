import { cn } from '@/lib/utils';

/**
 * 비어 있음 / 오류 상태.
 *
 * "데이터가 없습니다" 로 끝내지 않는다. 왜 비었는지와 **다음에 뭘 하면
 * 되는지**를 같이 준다. 빈 화면은 대부분 사용자가 뭔가 잘못했다고 느끼는
 * 순간이라, 여기서 안내를 놓치면 그대로 이탈한다.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  /** 보통 <Button> 하나. 둘 이상이면 감싸서 넘긴다. */
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-6 text-center',
        compact ? 'py-10' : 'py-16',
        className,
      )}
    >
      {icon ? (
        <div
          className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground"
          aria-hidden="true"
        >
          {icon}
        </div>
      ) : null}

      <p className="text-base font-semibold">{title}</p>

      {description ? (
        <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}

      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/**
 * 요청이 실패했을 때. 빈 상태와 구분해야 한다 —
 * "아직 없어요" 와 "못 불러왔어요" 는 사용자가 할 일이 전혀 다르다.
 */
export function ErrorState({
  title = '잠시 문제가 생겼어요',
  description = '네트워크 상태를 확인하고 다시 시도해 주세요.',
  onRetry,
  className,
}: {
  title?: string;
  description?: React.ReactNode;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <EmptyState
      title={title}
      description={description}
      className={className}
      action={
        onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="h-11 rounded-lg border border-input px-5 text-sm font-semibold transition-colors hover:bg-accent"
          >
            다시 시도
          </button>
        ) : undefined
      }
    />
  );
}
