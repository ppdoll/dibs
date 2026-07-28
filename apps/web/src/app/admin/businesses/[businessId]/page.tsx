import { BusinessDetail } from './business-detail';

export default async function Page({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  return <BusinessDetail businessId={businessId} />;
}
