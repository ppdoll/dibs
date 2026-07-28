import { cn } from '@/lib/utils';

export function Separator({
  className,
  orientation = 'horizontal',
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { orientation?: 'horizontal' | 'vertical' }) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      {...props}
    />
  );
}

/**
 * 섹션 사이의 두꺼운 구분. 모바일 앱에서 흔한 8px 회색 띠다.
 * 카드 사이 여백만으로는 "여기서 화제가 바뀐다" 가 잘 읽히지 않는다.
 */
export function SectionDivider({ className }: { className?: string }) {
  return <div className={cn('h-2 w-full bg-muted', className)} aria-hidden="true" />;
}
