'use client';

import { useState } from 'react';

import { cn } from '@/lib/utils';

const SIZES = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-14 w-14 text-lg',
} as const;

/**
 * 프로필 이미지.
 *
 * 구글 프로필 사진 URL 은 만료되거나 막히는 일이 잦다. 실패하면 이름
 * 첫 글자로 조용히 되돌아간다 — 깨진 이미지 아이콘이 뜨는 것보다 낫다.
 */
export function Avatar({
  src,
  name,
  size = 'md',
  className,
}: {
  src?: string | null;
  name?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const initial = (name ?? '').trim().charAt(0) || '·';

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted',
        'font-semibold text-muted-foreground',
        SIZES[size],
        className,
      )}
    >
      {src && !failed ? (
        // next/image 를 안 쓰는 이유: 외부 도메인이 유동적이라 remotePatterns 를
        // 미리 못 박는다. 아바타는 작아서 최적화 이득도 적다.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={name ? `${name} 프로필 사진` : '프로필 사진'}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden="true">{initial}</span>
      )}
    </span>
  );
}
