import { redirect } from 'next/navigation';

/**
 * 예전 경로 호환.
 *
 * 파트너·시설·이벤트·계정·공지 상세 화면이 이미 `/admin/audit-logs?targetType=…&targetId=…`
 * 로 "이 대상의 기록 보기"를 걸어 두었다. 감사 뷰어의 정식 경로는 `/admin/audit` 이지만,
 * 그 링크들을 죽이지 않으려고 쿼리스트링을 그대로 들고 넘긴다.
 *
 * 리다이렉트로 하는 이유(같은 화면을 두 경로에 두지 않는 이유)는 사이드바 활성 표시 때문이다.
 * 경로가 둘이면 어느 쪽으로 들어왔느냐에 따라 "감사 로그" 메뉴가 켜졌다 꺼졌다 한다.
 */
export default async function AuditLogsLegacyRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') search.set(key, value);
    // 같은 키가 여러 번 온 경우는 첫 값만 쓴다. 감사 필터는 전부 단일 값이다.
    else if (Array.isArray(value) && value[0] !== undefined) search.set(key, value[0]);
  }

  const query = search.toString();
  redirect(query.length > 0 ? `/admin/audit?${query}` : '/admin/audit');
}
