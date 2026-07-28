import type { Metadata } from 'next';

import { NewEventView } from './new-event-view';

export const metadata: Metadata = {
  title: '이벤트 만들기 · Dibs 파트너',
};

export default function NewEventPage() {
  return <NewEventView />;
}
