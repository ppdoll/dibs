import { ImageResponse } from 'next/og';

import { SQUARE, markDataUri } from '@/lib/brand';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/**
 * iOS 홈 화면 아이콘.
 *
 * 모서리를 깎지 않는다(`SQUARE`) — iOS 가 자기 마스크를 덧씌우기 때문에
 * 여기서 미리 둥글리면 모서리가 두 번 깎여 안쪽에 흰 삼각형이 남는다.
 *
 * PNG 로 내는 이유는 사파리가 apple-touch-icon 에서 SVG 를 안 받아서다.
 */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ display: 'flex', width: '100%', height: '100%' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={markDataUri({ size: 180, radius64: SQUARE })} alt="" width={180} height={180} />
      </div>
    ),
    size,
  );
}
