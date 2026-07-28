'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ExternalLink, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  Field,
  FieldHint,
  Input,
  Label,
  SkeletonList,
  useToast,
} from '@/components/ui';
import { apiDelete, apiGet, apiPatch, apiPost, isApiError, toUserMessage } from '@/lib/api-client';
import { formatNumber } from '@/lib/format';

/** GET /api/admin/categories */
interface AdminCategory {
  id: string;
  code: string;
  nameKo: string;
  nameEn: string | null;
  iconKey: string | null;
  sortOrder: number;
  isActive: boolean;
  parentId: string | null;
  venueCount: number;
  eventCount: number;
  children?: AdminCategory[];
}

const QK = ['admin', 'categories'] as const;

/**
 * 업종 관리.
 *
 * 이용자 홈의 카테고리 칩과 시설 등록 폼의 드롭다운이 전부 이 목록을 본다.
 * 그래서 화면이 강조하는 것은 "지금 쓰이고 있는가"다 — 시설·이벤트 수를 항상 함께 보여주고,
 * 쓰이는 업종은 삭제 대신 비활성을 권한다.
 */
export default function AdminCategoriesPage() {
  const qc = useQueryClient();
  const { success, error: toastError } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminCategory | null>(null);

  const query = useQuery({
    queryKey: QK,
    queryFn: () => apiGet<AdminCategory[]>('/api/admin/categories'),
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: QK });

  const toggle = useMutation({
    mutationFn: (c: AdminCategory) =>
      apiPatch(`/api/admin/categories/${c.id}`, { isActive: !c.isActive }),
    onSuccess: (_d, c) => {
      success(c.isActive ? `${c.nameKo} 비활성됨` : `${c.nameKo} 활성됨`);
      invalidate();
    },
    onError: (e) => toastError(toUserMessage(e)),
  });

  const reorder = useMutation({
    mutationFn: (orderedIds: string[]) => apiPost('/api/admin/categories/reorder', { orderedIds }),
    onSuccess: invalidate,
    onError: (e) => toastError(toUserMessage(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/admin/categories/${id}`),
    onSuccess: () => {
      success('업종을 삭제했어요');
      setDeleteTarget(null);
      invalidate();
    },
    onError: (e) => {
      // 사용 중이면 서버가 409 + 무엇이 쓰고 있는지 문구를 준다. 그대로 보여준다.
      toastError(toUserMessage(e));
      if (isApiError(e) && e.isConflict) setDeleteTarget(null);
    },
  });

  const roots = query.data ?? [];

  /** 위/아래 이동. 형제 전체 순서를 다시 보낸다 — 서버가 index 를 sortOrder 로 쓴다. */
  const move = (index: number, delta: number) => {
    const next = [...roots];
    const target = next[index];
    const swap = next[index + delta];
    if (!target || !swap) return;

    next[index] = swap;
    next[index + delta] = target;
    reorder.mutate(next.map((c) => c.id));
  };

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">업종 관리</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            이용자 홈의 카테고리 칩과 시설 등록 폼이 이 목록을 그대로 씁니다. 순서도 여기가 정해요.
          </p>
        </div>
        <Button size="sm" leadingIcon={<Plus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>
          업종 추가
        </Button>
      </div>

      {query.isLoading ? (
        <SkeletonList count={5} />
      ) : query.isError ? (
        <ErrorState title="목록을 불러오지 못했어요" onRetry={() => void query.refetch()} />
      ) : roots.length === 0 ? (
        <EmptyState title="업종이 없어요" description="업종을 추가하면 이용자 화면에 칩으로 나타나요." />
      ) : (
        <ul className="space-y-2">
          {roots.map((c, index) => (
            <li key={c.id}>
              <Card className={c.isActive ? '' : 'opacity-60'}>
                <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex flex-col">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="위로"
                        disabled={index === 0 || reorder.isPending}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="아래로"
                        disabled={index === roots.length - 1 || reorder.isPending}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{c.nameKo}</span>
                        <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                          {c.code}
                        </code>
                        {!c.isActive && <Badge variant="muted">비활성</Badge>}
                      </div>
                      {/* 숫자를 눌러 실제 목록으로 간다. "왜 삭제가 안 되지"를
                          화면에서 바로 확인할 수 있어야 한다. */}
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                        <UsageLink
                          href={`/admin/venues?categoryId=${c.id}`}
                          count={c.venueCount}
                          label="시설"
                          unit="곳"
                        />
                        <span aria-hidden="true">·</span>
                        <UsageLink
                          href={`/admin/events?categoryId=${c.id}`}
                          count={c.eventCount}
                          label="이벤트"
                          unit="건"
                        />
                        {c.nameEn ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{c.nameEn}</span>
                          </>
                        ) : null}
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={toggle.isPending}
                      onClick={() => toggle.mutate(c)}
                    >
                      {c.isActive ? '비활성으로' : '활성으로'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="삭제"
                      disabled={remove.isPending}
                      onClick={() => setDeleteTarget(c)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <CreateCategoryDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          success('업종을 추가했어요');
          invalidate();
        }}
      />

      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent dismissible={!remove.isPending}>
          <DialogHeader>
            <DialogTitle>{deleteTarget?.nameKo} 업종을 삭제할까요?</DialogTitle>
            <DialogDescription>
              시설이나 이벤트가 쓰고 있으면 삭제되지 않아요. 그럴 때는 <b>비활성</b>으로 바꾸면
              신규 등록과 검색에서만 사라지고 기존 데이터는 그대로 남아요.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={remove.isPending}>
              취소
            </Button>
            <Button
              variant="destructive"
              loading={remove.isPending}
              onClick={() => deleteTarget && remove.mutate(deleteTarget.id)}
            >
              삭제
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * 사용 현황 링크.
 *
 * 0건이면 링크로 만들지 않는다 — 눌러도 빈 목록만 나오고, 삭제 가능한 업종이라는
 * 신호가 오히려 흐려진다. 1건 이상일 때만 "무엇이 쓰고 있는지" 보러 갈 수 있게 한다.
 */
function UsageLink({
  href,
  count,
  label,
  unit,
}: {
  href: string;
  count: number;
  label: string;
  unit: string;
}) {
  const text = `${label} ${formatNumber(count)}${unit}`;

  if (count === 0) return <span>{text}</span>;

  return (
    <Link
      href={href}
      className="inline-flex items-center gap-0.5 font-medium text-foreground underline decoration-dotted underline-offset-2 hover:text-primary"
    >
      {text}
      <ExternalLink className="h-3 w-3" aria-hidden="true" />
    </Link>
  );
}

function CreateCategoryDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const { error: toastError } = useToast();
  const [code, setCode] = useState('');
  const [nameKo, setNameKo] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [iconKey, setIconKey] = useState('');

  const reset = () => {
    setCode('');
    setNameKo('');
    setNameEn('');
    setIconKey('');
  };

  const create = useMutation({
    mutationFn: () =>
      apiPost('/api/admin/categories', {
        code: code.trim(),
        nameKo: nameKo.trim(),
        ...(nameEn.trim() ? { nameEn: nameEn.trim() } : {}),
        ...(iconKey.trim() ? { iconKey: iconKey.trim() } : {}),
      }),
    onSuccess: () => {
      reset();
      onOpenChange(false);
      onCreated();
    },
    onError: (e) => toastError(toUserMessage(e)),
  });

  const codeError = isApiError(create.error) ? create.error.fieldMessage('code') : undefined;
  const nameError = isApiError(create.error) ? create.error.fieldMessage('nameKo') : undefined;
  const ready = code.trim().length >= 2 && nameKo.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !create.isPending && onOpenChange(o)}>
      <DialogContent dismissible={!create.isPending}>
        <DialogHeader>
          <DialogTitle>업종 추가</DialogTitle>
          <DialogDescription>추가하면 이용자 홈의 카테고리 칩에 바로 나타나요.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field>
            <Label htmlFor="cat-nameKo">이름</Label>
            <Input
              id="cat-nameKo"
              value={nameKo}
              onChange={(e) => setNameKo(e.target.value)}
              placeholder="예: 파인다이닝"
              maxLength={40}
            />
            {nameError && <FieldHint className="text-destructive">{nameError}</FieldHint>}
          </Field>

          <Field>
            <Label htmlFor="cat-code">코드</Label>
            <Input
              id="cat-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toLowerCase())}
              placeholder="예: fine-dining"
              maxLength={40}
            />
            <FieldHint className={codeError ? 'text-destructive' : undefined}>
              {codeError ??
                '영문 소문자·숫자·하이픈만. 검색 URL에 그대로 쓰이고 나중에 바꿀 수 없어요.'}
            </FieldHint>
          </Field>

          <Field>
            <Label htmlFor="cat-nameEn">영문 이름 (선택)</Label>
            <Input
              id="cat-nameEn"
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
              placeholder="Fine dining"
              maxLength={40}
            />
          </Field>

          <Field>
            <Label htmlFor="cat-icon">아이콘 키 (선택)</Label>
            <Input
              id="cat-icon"
              value={iconKey}
              onChange={(e) => setIconKey(e.target.value)}
              placeholder="utensils"
              maxLength={40}
            />
            <FieldHint>lucide 아이콘 이름이에요. 비우면 기본 아이콘을 써요.</FieldHint>
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            취소
          </Button>
          <Button disabled={!ready} loading={create.isPending} onClick={() => create.mutate()}>
            추가
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
