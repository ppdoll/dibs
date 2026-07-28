import { PartnerDetail } from './partner-detail';

/**
 * Next 15 에서 `params` 는 Promise 다. 서버 컴포넌트에서 한 번 풀어
 * 클라이언트 컴포넌트에 문자열로 넘긴다 — 화면 쪽에서 `useParams()` 의
 * `string | string[] | undefined` 를 매번 좁히는 것보다 깔끔하다.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ partnerProfileId: string }>;
}) {
  const { partnerProfileId } = await params;
  return <PartnerDetail profileId={partnerProfileId} />;
}
