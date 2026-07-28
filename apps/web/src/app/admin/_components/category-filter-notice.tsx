'use client';

import { useQuery } from '@tanstack/react-query';
import { Tags, X } from 'lucide-react';
import Link from 'next/link';

import { apiGet } from '@/lib/api-client';

interface AdminCategoryLite {
  id: string;
  nameKo: string;
  code: string;
  children?: AdminCategoryLite[];
}

/**
 * "업종으로 걸러서 보는 중"임을 알려주고 해제 경로를 준다.
 *
 * 업종 관리 화면의 "시설 3곳"을 눌러 넘어오면 목록이 갑자기 짧아진다. 왜 짧아졌는지
 * 화면에 적어 두지 않으면 데이터가 사라진 줄 알고 놀란다 — 특히 상태 탭까지 함께
 * 무시되므로(업종 필터일 때 서버가 상태 기본값을 빼준다) 평소와 다르게 보인다.
 *
 * 업종 이름은 목록 API 를 한 번 더 불러 찾는다. id 만으로는 사람이 무엇으로
 * 걸러졌는지 알 수 없고, 그렇다고 URL 에 이름을 실으면 이름을 바꾼 뒤 링크가 거짓말을 한다.
 */
export function CategoryFilterNotice({
  categoryId,
  onClear,
}: {
  categoryId: string;
  onClear: () => void;
}) {
  const { data } = useQuery({
    queryKey: ['admin', 'categories'],
    queryFn: () => apiGet<AdminCategoryLite[]>('/api/admin/categories'),
    staleTime: 5 * 60_000,
  });

  const flat = (data ?? []).flatMap((c) => [c, ...(c.children ?? [])]);
  const category = flat.find((c) => c.id === categoryId);

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
      <Tags className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <span>
        <b>{category?.nameKo ?? '선택한 업종'}</b> 업종으로 걸러서 보고 있어요. 상태와 무관하게
        전부 나옵니다.
      </span>

      <button
        type="button"
        onClick={onClear}
        className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium hover:bg-accent"
      >
        <X className="h-3 w-3" aria-hidden="true" />
        필터 해제
      </button>

      <Link
        href="/admin/categories"
        className="text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        업종 관리로
      </Link>
    </div>
  );
}
