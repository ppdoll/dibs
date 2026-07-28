'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useToast } from '@/components/ui';
import { toUserMessage } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';

/**
 * 운영 조치 하나를 실행하는 mutation.
 *
 * 조치가 끝나면 `qk.admin.all` 전체를 무효화한다. 굵게 잡은 것은 의도다 —
 * 파트너 하나를 승인하면 심사 큐, 그 파트너 상세, **대시보드의 대기 건수**가 함께
 * 달라진다. 화면마다 무효화할 키를 손으로 고르면 언젠가 대시보드만 옛 숫자로 남는다.
 * 콘솔은 동시 사용자가 몇 명뿐이라 과잉 재조회의 비용보다 어긋난 숫자의 비용이 크다.
 *
 * 실패 문구는 서버가 준 것을 그대로 쓴다(`toUserMessage`). 프론트에서 다시 지어내면
 * 상태 전이 규칙이 바뀔 때 조용히 어긋난다.
 */
export function useAdminAction<TVars, TData>(
  mutationFn: (vars: TVars) => Promise<TData>,
  options: {
    successTitle: string;
    successDescription?: string;
    /** 성공 후 추가로 할 일. 다이얼로그 닫기·상세로 이동 등. */
    onDone?: (data: TData, vars: TVars) => void;
    /** 실패해도 토스트를 띄우지 않는다. 폼 안에 배너로 직접 그릴 때. */
    silentError?: boolean;
  },
) {
  const queryClient = useQueryClient();
  const { toast, error: toastError } = useToast();

  return useMutation({
    mutationFn,
    // 조치는 절대 자동 재시도하지 않는다. 승인·정지·발송은 두 번 나가면 안 된다.
    retry: false,
    onSuccess: async (data, vars) => {
      await queryClient.invalidateQueries({ queryKey: qk.admin.all });
      toast({
        title: options.successTitle,
        variant: 'success',
        ...(options.successDescription ? { description: options.successDescription } : {}),
      });
      options.onDone?.(data, vars);
    },
    onError: (error) => {
      if (options.silentError) return;
      toastError('처리하지 못했습니다', toUserMessage(error));
    },
  });
}
