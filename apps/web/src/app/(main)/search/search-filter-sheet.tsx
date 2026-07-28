'use client';

import { useEffect, useState } from 'react';

import {
  Button,
  Chip,
  ChipGroup,
  Field,
  Input,
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Skeleton,
} from '@/components/ui';
import { formatWonCompact, parseWonInput } from '@/lib/format';
import type { EventModeValue } from '@/types/api';

import { useCategories } from '../_lib/queries';
import { RegionFilterSheet } from '../_components/region-filter-sheet';

/**
 * 검색 필터 시트.
 *
 * 페이지가 아니라 시트인 이유: 조건을 바꾸면서 뒤의 결과가 얼마나 남는지
 * 보고 싶어 한다. 화면을 갈아엎으면 "몇 개나 나오려나"를 매번 왕복해서 확인하게 된다.
 *
 * 값은 **적용을 눌러야** 부모로 나간다. 칩을 만질 때마다 검색을 날리면
 * 조건을 세 개 바꾸는 동안 요청이 세 번 나가고 목록이 세 번 흔들린다.
 */

export interface SearchFilters {
  sigunguCode: string | null;
  regionLabel: string | null;
  categoryId: string | null;
  mode: EventModeValue | null;
  amountFrom: number | null;
  amountTo: number | null;
  deadlineSoon: boolean;
}

export const EMPTY_FILTERS: SearchFilters = {
  sigunguCode: null,
  regionLabel: null,
  categoryId: null,
  mode: null,
  amountFrom: null,
  amountTo: null,
  deadlineSoon: false,
};

/** 자주 쓰는 예산 구간. 직접 입력보다 이쪽을 훨씬 많이 쓴다. */
const AMOUNT_PRESETS: { label: string; from: number | null; to: number | null }[] = [
  { label: '3만원 이하', from: null, to: 30_000 },
  { label: '3~7만원', from: 30_000, to: 70_000 },
  { label: '7~15만원', from: 70_000, to: 150_000 },
  { label: '15만원 이상', from: 150_000, to: null },
];

export function countActiveFilters(filters: SearchFilters): number {
  let count = 0;
  if (filters.sigunguCode) count += 1;
  if (filters.categoryId) count += 1;
  if (filters.mode) count += 1;
  if (filters.amountFrom !== null || filters.amountTo !== null) count += 1;
  if (filters.deadlineSoon) count += 1;
  return count;
}

export function SearchFilterSheet({
  open,
  onOpenChange,
  value,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: SearchFilters;
  onApply: (next: SearchFilters) => void;
}) {
  const [draft, setDraft] = useState<SearchFilters>(value);
  const [regionOpen, setRegionOpen] = useState(false);

  // 시트를 다시 열 때마다 바깥의 현재 조건에서 시작한다.
  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  const categories = useCategories();
  const flatCategories = (categories.data ?? []).flatMap((category) => [
    category,
    ...category.children,
  ]);

  const patch = (part: Partial<SearchFilters>) => setDraft((prev) => ({ ...prev, ...part }));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[88dvh]">
        <SheetHeader>
          <SheetTitle>필터</SheetTitle>
        </SheetHeader>
        <SheetClose />

        <SheetBody className="space-y-6">
          <section>
            <h3 className="mb-2 text-sm font-bold">지역</h3>
            <Button
              variant="outline"
              full
              className="justify-between"
              onClick={() => setRegionOpen(true)}
            >
              <span>{draft.regionLabel ?? '전체 지역'}</span>
              <span className="text-muted-foreground">선택</span>
            </Button>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-bold">업종</h3>
            {categories.isPending ? (
              <div className="flex gap-2">
                {Array.from({ length: 4 }).map((_, index) => (
                  <Skeleton key={index} className="h-8 w-16 rounded-full" />
                ))}
              </div>
            ) : (
              <ChipGroup className="flex-wrap overflow-visible">
                <Chip
                  selected={draft.categoryId === null}
                  onClick={() => patch({ categoryId: null })}
                >
                  전체
                </Chip>
                {flatCategories.map((category) => (
                  <Chip
                    key={category.id}
                    selected={draft.categoryId === category.id}
                    onClick={() => patch({ categoryId: category.id })}
                  >
                    {category.nameKo}
                  </Chip>
                ))}
              </ChipGroup>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-bold">진행 방식</h3>
            <ChipGroup className="flex-wrap overflow-visible">
              <Chip selected={draft.mode === null} onClick={() => patch({ mode: null })}>
                전체
              </Chip>
              <Chip
                selected={draft.mode === 'INSTANT'}
                onClick={() => patch({ mode: 'INSTANT' })}
              >
                선착순 즉시확정
              </Chip>
              <Chip selected={draft.mode === 'BID'} onClick={() => patch({ mode: 'BID' })}>
                금액 제안
              </Chip>
            </ChipGroup>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-bold">금액대</h3>
            <ChipGroup className="flex-wrap overflow-visible">
              <Chip
                selected={draft.amountFrom === null && draft.amountTo === null}
                onClick={() => patch({ amountFrom: null, amountTo: null })}
              >
                전체
              </Chip>
              {AMOUNT_PRESETS.map((preset) => (
                <Chip
                  key={preset.label}
                  selected={draft.amountFrom === preset.from && draft.amountTo === preset.to}
                  onClick={() => patch({ amountFrom: preset.from, amountTo: preset.to })}
                >
                  {preset.label}
                </Chip>
              ))}
            </ChipGroup>

            <div className="mt-3 flex items-center gap-2">
              <Field label="최소" htmlFor="amount-from" className="flex-1">
                <Input
                  id="amount-from"
                  inputMode="numeric"
                  placeholder="0"
                  trailing="원"
                  value={draft.amountFrom === null ? '' : draft.amountFrom.toLocaleString('ko-KR')}
                  onChange={(event) => patch({ amountFrom: parseWonInput(event.target.value) })}
                />
              </Field>
              <span className="mt-6 text-muted-foreground">~</span>
              <Field label="최대" htmlFor="amount-to" className="flex-1">
                <Input
                  id="amount-to"
                  inputMode="numeric"
                  placeholder="제한 없음"
                  trailing="원"
                  value={draft.amountTo === null ? '' : draft.amountTo.toLocaleString('ko-KR')}
                  onChange={(event) => patch({ amountTo: parseWonInput(event.target.value) })}
                />
              </Field>
            </div>

            <p className="mt-1.5 text-xs text-muted-foreground">
              내가 낼 수 있는 금액 기준이에요. 다른 사람이 얼마를 냈는지와는 관계없어요.
            </p>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-bold">마감</h3>
            <ChipGroup className="flex-wrap overflow-visible">
              <Chip
                selected={!draft.deadlineSoon}
                onClick={() => patch({ deadlineSoon: false })}
              >
                전체
              </Chip>
              <Chip
                selected={draft.deadlineSoon}
                onClick={() => patch({ deadlineSoon: true })}
              >
                48시간 내 마감
              </Chip>
            </ChipGroup>
          </section>

          {(draft.amountFrom !== null || draft.amountTo !== null) && (
            <p className="text-sm text-muted-foreground">
              선택한 예산: {draft.amountFrom === null ? '제한 없음' : formatWonCompact(draft.amountFrom)}
              {' ~ '}
              {draft.amountTo === null ? '제한 없음' : formatWonCompact(draft.amountTo)}
            </p>
          )}
        </SheetBody>

        <SheetFooter>
          <Button variant="outline" onClick={() => setDraft(EMPTY_FILTERS)} className="shrink-0">
            초기화
          </Button>
          <Button
            full
            onClick={() => {
              onApply(draft);
              onOpenChange(false);
            }}
          >
            적용하기
          </Button>
        </SheetFooter>
      </SheetContent>

      <RegionFilterSheet
        open={regionOpen}
        onOpenChange={setRegionOpen}
        selectedCode={draft.sigunguCode}
        onSelect={(value) =>
          patch({ sigunguCode: value.sigunguCode, regionLabel: value.sigunguCode ? value.label : null })
        }
      />
    </Sheet>
  );
}
