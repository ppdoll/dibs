import { ImageResponse } from 'next/og';

import { markDataUri } from '@/lib/brand';

/**
 * PWA 매니페스트용 192px 아이콘.
 *
 * 파일 규약(`app/icon.*`)을 쓰지 않은 이유: 그쪽은 Next 가 해시 붙은 URL 을 만들어서
 * 매니페스트에 고정 주소로 적을 수 없다. 라우트 핸들러는 주소가 곧 폴더명이라 고정된다.
 *
 * `force-static` — 빌드 시점에 한 번 그려 정적 파일로 굳힌다. 런타임 렌더링이 없다.
 */
export const dynamic = 'force-static';

export function GET() {
  return new ImageResponse(
    (
      <div style={{ display: 'flex', width: '100%', height: '100%' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={markDataUri({ size: 192 })} alt="" width={192} height={192} />
      </div>
    ),
    { width: 192, height: 192 },
  );
}
