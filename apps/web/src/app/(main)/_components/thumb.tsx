import { ImageIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * 카드 썸네일.
 *
 * next/image 를 쓰지 않는다. 이미지 호스트가 next.config 의 remotePatterns 에
 * 없으면 next/image 는 **렌더 자체를 실패**시킨다. 파트너가 올린 이미지의 호스트가
 * 언젠가 바뀌면 카드 한 장이 아니라 목록 화면이 통째로 죽는다는 뜻이다.
 * 사진이 안 뜨는 것과 화면이 안 뜨는 것 사이에서 전자를 고른다.
 *
 * 사진이 없을 때 회색 사각형 대신 아이콘을 두는 이유: 목록에서 "로딩 중"과
 * "사진 없음"이 같아 보이면 사용자는 계속 기다린다.
 */
export function Thumb({
  src,
  alt,
  className,
  ratio = 'aspect-[4/3]',
  rounded = 'rounded-lg',
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
  ratio?: string;
  rounded?: string;
}) {
  return (
    <div
      className={cn(
        'relative overflow-hidden bg-muted',
        ratio,
        rounded,
        className,
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground/50">
          <ImageIcon className="h-7 w-7" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}
