'use client';

import { Check } from 'lucide-react';
import { useState } from 'react';

import {
  Button,
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SkeletonList,
} from '@/components/ui';
import { cn } from '@/lib/utils';

import { useRegions } from '../_lib/queries';

/**
 * 지역 선택 바텀시트.
 *
 * 왼쪽 시/도 → 오른쪽 시/군/구의 2단 구조다. 한 번에 250개를 뿌리면
 * 엄지로 훑기만 하다 끝난다. 시/도를 고르는 순간 오른쪽만 다시 읽는다.
 *
 * 서버가 이벤트를 거를 때 쓰는 값은 **행정표준코드 5자리(sigunguCode)** 다.
 * Region.code(법정동 10자리)와 값 공간이 달라서, 넘길 때 sigunguCode 만 쓴다.
 */
export function RegionFilterSheet({
  open,
  onOpenChange,
  selectedCode,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCode: string | null;
  onSelect: (value: { sigunguCode: string | null; label: string }) => void;
}) {
  const [sidoCode, setSidoCode] = useState<string | null>(null);

  const sidoQuery = useRegions();
  const sigunguQuery = useRegions(sidoCode ?? undefined);

  const sidos = sidoQuery.data ?? [];
  const sigungus = sidoCode ? (sigunguQuery.data ?? []) : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[70dvh]">
        <SheetHeader>
          <SheetTitle>지역 선택</SheetTitle>
        </SheetHeader>
        <SheetClose />

        <SheetBody className="px-0 py-0">
          <div className="flex h-full">
            <ul className="w-[38%] shrink-0 overflow-y-auto border-r bg-muted/40">
              {sidoQuery.isPending ? (
                <li className="p-4">
                  <SkeletonList count={6} />
                </li>
              ) : (
                sidos.map((region) => (
                  <li key={region.code}>
                    <button
                      type="button"
                      onClick={() => setSidoCode(region.code)}
                      className={cn(
                        'w-full px-4 py-3.5 text-left text-sm',
                        sidoCode === region.code
                          ? 'bg-background font-bold text-foreground'
                          : 'text-muted-foreground',
                      )}
                    >
                      {region.displayName}
                    </button>
                  </li>
                ))
              )}
            </ul>

            <ul className="flex-1 overflow-y-auto">
              {!sidoCode ? (
                <li className="px-4 py-6 text-sm text-muted-foreground">
                  왼쪽에서 시·도를 먼저 골라 주세요.
                </li>
              ) : sigunguQuery.isPending ? (
                <li className="p-4">
                  <SkeletonList count={6} />
                </li>
              ) : sigungus.length === 0 ? (
                <li className="px-4 py-6 text-sm text-muted-foreground">
                  하위 지역이 없어요.
                </li>
              ) : (
                sigungus.map((region) => {
                  const code = region.sigunguCode;
                  const active = code !== null && code === selectedCode;

                  return (
                    <li key={region.code}>
                      <button
                        type="button"
                        disabled={code === null}
                        onClick={() => {
                          if (code === null) return;
                          onSelect({ sigunguCode: code, label: region.displayName });
                          onOpenChange(false);
                        }}
                        className={cn(
                          'flex w-full items-center justify-between px-4 py-3.5 text-left text-sm',
                          active ? 'font-bold text-primary' : 'text-foreground',
                          code === null && 'opacity-40',
                        )}
                      >
                        {region.displayName}
                        {active ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        </SheetBody>

        <SheetFooter>
          <Button
            variant="outline"
            full
            onClick={() => {
              onSelect({ sigunguCode: null, label: '전체 지역' });
              onOpenChange(false);
            }}
          >
            전체 지역 보기
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
