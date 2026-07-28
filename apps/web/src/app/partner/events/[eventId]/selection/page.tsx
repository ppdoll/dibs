import type { Metadata } from 'next';

import { SelectionView } from './selection-view';

export const metadata: Metadata = {
  title: '당첨자 확정 · Dibs 파트너',
};

export default async function SelectionPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  return <SelectionView eventId={eventId} />;
}
