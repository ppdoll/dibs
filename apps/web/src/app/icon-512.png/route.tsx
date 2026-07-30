import { ImageResponse } from 'next/og';

import { markDataUri } from '@/lib/brand';

/** PWA 매니페스트용 512px 아이콘 (`purpose: any`). 배경은 여기서 둥글린다. */
export const dynamic = 'force-static';

export function GET() {
  return new ImageResponse(
    (
      <div style={{ display: 'flex', width: '100%', height: '100%' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={markDataUri({ size: 512 })} alt="" width={512} height={512} />
      </div>
    ),
    { width: 512, height: 512 },
  );
}
