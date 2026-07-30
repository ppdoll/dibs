import { ImageResponse } from 'next/og';

import { SQUARE, markDataUri } from '@/lib/brand';

/**
 * PWA 매니페스트용 maskable 아이콘.
 *
 * 안드로이드는 런처 모양(원·물방울·사각)에 맞춰 아이콘을 **직접 잘라낸다.** `any` 아이콘만
 * 있으면 흰 원 안에 축소해 끼워 넣어서 테두리가 남는다. maskable 을 주면 가장자리까지 채운다.
 *
 * 그래서 모서리를 깎지 않는다(`SQUARE`) — 자르는 건 런처의 일이다.
 *
 * 안전영역은 가운데 80% 원(64 격자에서 반지름 25.6)이다. 마크에서 중심으로부터 가장 먼 점은
 * 위쪽 모서리 (19,12) 로 거리 23.85 — 배율을 줄이지 않아도 들어간다.
 */
export const dynamic = 'force-static';

export function GET() {
  return new ImageResponse(
    (
      <div style={{ display: 'flex', width: '100%', height: '100%' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={markDataUri({ size: 512, radius64: SQUARE })} alt="" width={512} height={512} />
      </div>
    ),
    { width: 512, height: 512 },
  );
}
