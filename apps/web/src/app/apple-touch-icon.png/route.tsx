import { ImageResponse } from 'next/og';

import { SQUARE, markDataUri } from '@/lib/brand';

/**
 * iOS 의 관례 경로 폴백.
 *
 * `<link rel="apple-touch-icon">` 이 이미 있는데도 이 파일을 두는 이유:
 * iOS 는 링크 태그를 못 쓰는 상황(캐시된 옛 HTML, 링크 URL 의 쿼리스트링 처리 실패 등)에서
 * **루트의 `/apple-touch-icon.png` 를 직접 찾는다.** 없으면 홈 화면 아이콘이 페이지 스크린샷이 된다.
 * 180×180 PNG 한 장이라 보험 비용이 거의 없다.
 */
export const dynamic = 'force-static';

export function GET() {
  return new ImageResponse(
    (
      <div style={{ display: 'flex', width: '100%', height: '100%' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={markDataUri({ size: 180, radius64: SQUARE })} alt="" width={180} height={180} />
      </div>
    ),
    { width: 180, height: 180 },
  );
}
