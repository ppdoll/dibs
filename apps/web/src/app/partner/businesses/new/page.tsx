import type { Metadata } from 'next';

import { NewBusinessView } from './new-business-view';

export const metadata: Metadata = {
  title: '사업자 등록 · Dibs 파트너',
};

export default function NewBusinessPage() {
  return <NewBusinessView />;
}
