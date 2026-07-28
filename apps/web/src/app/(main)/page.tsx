import type { Metadata } from 'next';

import { HomeFeed } from './home-feed';

export const metadata: Metadata = {
  title: '홈',
  description: '가고 싶던 그곳, 열리는 순간 먼저 찜하세요.',
};

/**
 * 홈.
 *
 * 서버 컴포넌트는 껍데기만 맡고 데이터는 클라이언트가 읽는다. 홈 피드는
 * 지역 필터가 사용자 기기에 저장되어 있고 경쟁률이 계속 변해서,
 * 서버에서 한 번 굳혀 보내면 다음 사람에게 남의 지역·옛 경쟁률이 간다.
 */
export default function HomePage() {
  return <HomeFeed />;
}
