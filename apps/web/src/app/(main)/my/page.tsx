import type { Metadata } from 'next';

import { MyScreen } from './my-screen';

export const metadata: Metadata = {
  title: '내정보',
};

export default function MyPage() {
  return <MyScreen />;
}
