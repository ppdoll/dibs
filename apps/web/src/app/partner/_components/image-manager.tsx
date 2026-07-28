'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, GripVertical, ImagePlus, Star, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { IMAGE_CONTENT_TYPES } from '../_lib/types';
import { ErrorBanner, InfoNote } from './partner-page';
import { formatBytes } from '../_lib/blob';
import { toPartnerMessage } from '../_lib/errors';

/**
 * 사진 관리 (업로드 · 순서 · 대표 지정 · 삭제).
 *
 * 시설과 이벤트가 같은 화면을 쓴다. 엔드포인트만 다르고 규칙이 똑같기 때문인데,
 * 특히 **순서 재배치는 살아 있는 이미지 전체를 보내야 한다**는 제약이 양쪽 공통이다.
 * 서버의 (대상, sortOrder) 부분 유니크는 DEFERRABLE 이 될 수 없어서 재배치가
 * "전부 음수로 대피 → 최종값 쓰기" 2단계인데, 일부만 보내면 대피하지 않은 행과 충돌한다.
 *
 * 드래그만 지원하지 않는 이유: 콘솔은 폰에서도 열리고, 드래그 앤 드롭은 터치와
 * 스크린리더 양쪽에서 사실상 동작하지 않는다. ↑↓ 버튼을 늘 함께 둔다.
 */

const IMAGE_MAX_BYTES = 8 * 1024 * 1024;

export interface ManagedImage {
  id: string;
  url: string;
  alt: string | null;
  sortOrder: number;
  isCover: boolean;
  status?: string;
  quarantineReason?: string | null;
}

export interface ImageAdapter {
  queryKey: readonly unknown[];
  maxImages: number;
  list: () => Promise<ManagedImage[]>;
  /** 티켓 발급 → Blob 직접 업로드 → 등록까지 한 번에. */
  upload: (file: File) => Promise<unknown>;
  reorder: (imageIds: string[]) => Promise<unknown>;
  setCover: (imageId: string) => Promise<unknown>;
  remove: (imageId: string) => Promise<unknown>;
  updateAlt?: (imageId: string, altText: string) => Promise<unknown>;
}

export function ImageManager({ adapter }: { adapter: ImageAdapter }) {
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  /** 낙관적 순서. 서버 왕복을 기다리면 드래그가 되돌아가는 것처럼 보인다. */
  const [order, setOrder] = useState<ManagedImage[] | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ManagedImage | null>(null);
  const [altEditing, setAltEditing] = useState<{ id: string; value: string } | null>(null);

  const images = useQuery({
    queryKey: adapter.queryKey,
    queryFn: adapter.list,
  });

  // 서버 목록이 바뀌면 낙관적 순서를 버린다. 안 그러면 삭제된 사진이 남아 있는다.
  useEffect(() => {
    if (images.data) setOrder(images.data);
  }, [images.data]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: adapter.queryKey });

  const reorder = useMutation({
    mutationFn: (ids: string[]) => adapter.reorder(ids),
    onSuccess: () => void invalidate(),
    onError: (error) => {
      setOrder(images.data ?? null);
      toastError('순서를 저장하지 못했어요', toPartnerMessage(error));
    },
  });

  const setCover = useMutation({
    mutationFn: (imageId: string) => adapter.setCover(imageId),
    onSuccess: async () => {
      await invalidate();
      success('대표 사진을 바꿨어요');
    },
    onError: (error) => toastError('대표 사진을 바꾸지 못했어요', toPartnerMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (imageId: string) => adapter.remove(imageId),
    onSuccess: async () => {
      await invalidate();
      setPendingDelete(null);
      success('사진을 삭제했어요');
    },
    onError: (error) => toastError('삭제하지 못했어요', toPartnerMessage(error)),
  });

  const saveAlt = useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) =>
      adapter.updateAlt ? adapter.updateAlt(id, value) : Promise.resolve(),
    onSuccess: async () => {
      await invalidate();
      setAltEditing(null);
      success('설명을 저장했어요');
    },
    onError: (error) => toastError('설명을 저장하지 못했어요', toPartnerMessage(error)),
  });

  const list = order ?? [];

  const commitOrder = (next: ManagedImage[]) => {
    setOrder(next);
    reorder.mutate(next.map((image) => image.id));
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    const current = list[index];
    const swap = list[target];
    if (!current || !swap) return;

    const next = [...list];
    next[index] = swap;
    next[target] = current;
    commitOrder(next);
  };

  const handleDrop = (targetId: string) => {
    if (!draggingId || draggingId === targetId) return;

    const from = list.findIndex((image) => image.id === draggingId);
    const to = list.findIndex((image) => image.id === targetId);
    const moved = list[from];
    if (from < 0 || to < 0 || !moved) return;

    const next = [...list];
    next.splice(from, 1);
    next.splice(to, 0, moved);
    commitOrder(next);
    setDraggingId(null);
  };

  const handleFiles = async (files: FileList) => {
    setUploadError(null);

    const picked = Array.from(files);
    const room = adapter.maxImages - list.length;

    if (room <= 0) {
      setUploadError(`사진은 최대 ${adapter.maxImages}장까지 올릴 수 있어요.`);
      return;
    }

    setUploading(true);
    try {
      // 한 장씩 순서대로 올린다. 병렬로 올리면 서버가 sortOrder 를 max+1 로 잡는 사이에
      // 서로 같은 값을 노려 유니크 충돌(409)이 난다.
      for (const file of picked.slice(0, room)) {
        if (!(IMAGE_CONTENT_TYPES as readonly string[]).includes(file.type)) {
          throw new Error('JPG, PNG, WebP, AVIF 파일만 올릴 수 있어요.');
        }
        if (file.size > IMAGE_MAX_BYTES) {
          throw new Error(`${file.name} 은(는) 너무 커요. ${formatBytes(IMAGE_MAX_BYTES)} 이하로 올려 주세요.`);
        }
        await adapter.upload(file);
      }
      await invalidate();
      success('사진을 올렸어요');
    } catch (error) {
      setUploadError(toPartnerMessage(error));
      await invalidate();
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (images.isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="aspect-[4/3]" />
        ))}
      </div>
    );
  }

  if (images.isError) {
    return (
      <ErrorState
        title="사진을 불러오지 못했어요"
        description={toPartnerMessage(images.error)}
        onRetry={() => void images.refetch()}
      />
    );
  }

  return (
    <div className="space-y-4">
      <ErrorBanner message={uploadError} />

      <InfoNote>
        첫 번째 사진이 목록 카드에 크게 보여요. 순서는 드래그하거나 ↑↓ 버튼으로 바꿀 수 있고,
        대표 사진은 별을 눌러 지정해요. 사진은 최대 {adapter.maxImages}장까지 올릴 수 있어요.
      </InfoNote>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept={IMAGE_CONTENT_TYPES.join(',')}
          multiple
          className="hidden"
          onChange={(event) => {
            if (event.target.files && event.target.files.length > 0) {
              void handleFiles(event.target.files);
            }
          }}
        />
        <Button
          variant="outline"
          loading={uploading}
          disabled={list.length >= adapter.maxImages}
          leadingIcon={<ImagePlus className="h-4 w-4" aria-hidden="true" />}
          onClick={() => fileInputRef.current?.click()}
        >
          사진 올리기
        </Button>
        <span className="text-sm text-muted-foreground">
          {list.length} / {adapter.maxImages}장
        </span>
      </div>

      {list.length === 0 ? (
        <EmptyState
          compact
          icon={<ImagePlus className="h-6 w-6" aria-hidden="true" />}
          title="아직 올린 사진이 없어요"
          description="첫 사진이 목록 카드의 얼굴이 돼요. 밝고 넓게 찍힌 사진을 추천해요."
        />
      ) : (
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {list.map((image, index) => (
            <li
              key={image.id}
              draggable
              onDragStart={() => setDraggingId(image.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => handleDrop(image.id)}
              onDragEnd={() => setDraggingId(null)}
              className={cn(
                'overflow-hidden rounded-lg border bg-card transition-opacity',
                draggingId === image.id && 'opacity-50',
              )}
            >
              <div className="relative aspect-[4/3] bg-muted">
                {/* next/image 대신 img 를 쓰는 이유: Blob 도메인을 next.config 에 등록해야
                    하는데 그 파일은 다른 담당의 영역이다. 콘솔 미리보기라 최적화 이득도 작다. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.url}
                  alt={image.alt ?? ''}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />

                <div className="absolute left-2 top-2 flex gap-1">
                  {image.isCover ? <Badge variant="overlay">대표</Badge> : null}
                  {image.status === 'QUARANTINED' ? (
                    <Badge variant="destructive">검토 보류</Badge>
                  ) : null}
                  {image.status === 'PENDING' ? <Badge variant="warning">업로드 중</Badge> : null}
                </div>

                <span
                  className="absolute right-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-xs font-semibold text-white"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
              </div>

              <div className="flex items-center justify-between gap-1 p-2">
                <span className="text-muted-foreground" aria-hidden="true">
                  <GripVertical className="h-4 w-4" />
                </span>

                <div className="flex items-center gap-0.5">
                  <IconButton
                    label="앞으로 옮기기"
                    disabled={index === 0 || reorder.isPending}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp className="h-4 w-4" aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    label="뒤로 옮기기"
                    disabled={index === list.length - 1 || reorder.isPending}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    label={image.isCover ? '이미 대표 사진이에요' : '대표 사진으로 지정'}
                    disabled={image.isCover || setCover.isPending}
                    onClick={() => setCover.mutate(image.id)}
                  >
                    <Star
                      className={cn('h-4 w-4', image.isCover && 'fill-current text-amber-500')}
                      aria-hidden="true"
                    />
                  </IconButton>
                  <IconButton
                    label="사진 삭제"
                    className="text-destructive"
                    onClick={() => setPendingDelete(image)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </IconButton>
                </div>
              </div>

              {adapter.updateAlt ? (
                <button
                  type="button"
                  onClick={() => setAltEditing({ id: image.id, value: image.alt ?? '' })}
                  className="w-full truncate border-t px-2 py-1.5 text-left text-xs text-muted-foreground hover:text-foreground"
                >
                  {image.alt ? image.alt : '설명 추가 (화면 낭독용)'}
                </button>
              ) : null}

              {image.quarantineReason ? (
                <p className="border-t px-2 py-1.5 text-xs text-destructive">
                  {image.quarantineReason}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>사진을 삭제할까요?</DialogTitle>
            <DialogDescription>
              되돌릴 수 없어요. 대표 사진이었다면 다른 사진을 다시 지정해 주세요.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              취소
            </Button>
            <Button
              variant="destructive"
              loading={remove.isPending}
              onClick={() => pendingDelete && remove.mutate(pendingDelete.id)}
            >
              삭제하기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={altEditing !== null} onOpenChange={(open) => !open && setAltEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>사진 설명</DialogTitle>
            <DialogDescription>
              화면을 못 보는 분에게 읽어주는 문장이에요. "창가 2인석" 처럼 사진에 무엇이 있는지 적어 주세요.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={altEditing?.value ?? ''}
            onChange={(event) =>
              setAltEditing((prev) => (prev ? { ...prev, value: event.target.value } : prev))
            }
            maxLength={120}
            placeholder="창가 2인석"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAltEditing(null)}>
              취소
            </Button>
            <Button
              loading={saveAlt.isPending}
              onClick={() => altEditing && saveAlt.mutate(altEditing)}
            >
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
