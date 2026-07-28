'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert, ShieldCheck } from 'lucide-react';

import { Button, Chip, ChipGroup, Input } from '@/components/ui';
import { apiGet, toUserMessage } from '@/lib/api-client';
import { formatNumber } from '@/lib/format';
import { qk } from '@/lib/query-keys';

import { FilterSelect, Notice, Panel } from '../../_components/console';
import type { AdminAuditVerifyResult } from '../../_lib/types';

/**
 * 체인 무결성 검사.
 *
 * 감사 로그의 각 행은 직전 행의 해시(prevHash)를 품는다. 그래서 중간의 한 행을 지우거나
 * 끼워 넣거나 고치면 그 뒤의 연결이 어긋난다 — **기록이 사후에 조작되지 않았음을
 * 증명하는 장치**가 체인이다. 이 버튼은 그 연결을 처음부터 훑어 확인한다.
 *
 * 세 가지가 이 화면의 규칙이다.
 *
 * 1. **자동으로 돌리지 않는다.** GET 이지만 서버가 `SYSTEM_AUDIT_CHAIN_VERIFIED` 감사 행을
 *    남긴다("언제 마지막으로 확인했는가"도 증거의 일부다). 화면을 열 때마다, 재조회할
 *    때마다 돌면 체인이 검사 기록으로만 가득 찬다. 그래서 useQuery 가 아니라 mutation 이다.
 * 2. **결과를 토스트로 알리지 않는다.** "검사 완료"와 "무결성이 깨졌다"는 전혀 다른 소식인데
 *    토스트로 뭉뚱그리면 후자가 3초 만에 사라진다. 결과는 화면에 남는 배너로 그린다.
 * 3. **체인은 샤드로 나뉘어 있다.** 대상 종류(USER · SETTING …)나 `event:<id>` 처럼 한 이벤트
 *    단위로 갈라진다. 그래서 "전체 검사"라는 것은 없고, 어느 샤드를 볼지 골라야 한다.
 */

/** 자주 보는 샤드. 이벤트 단위 샤드는 `event:<이벤트ID>` 라 직접 입력해야 한다. */
const QUICK_KEYS = ['SYSTEM', 'SETTING', 'USER', 'PARTNER_PROFILE', 'BUSINESS', 'VENUE', 'EVENT'];

const LIMIT_OPTIONS = [
  { value: '200', label: '200행' },
  { value: '500', label: '500행' },
  { value: '1000', label: '1,000행' },
  { value: '2000', label: '2,000행' },
];

export function ChainVerifyPanel() {
  const queryClient = useQueryClient();
  const [chainKey, setChainKey] = useState('SYSTEM');
  const [limit, setLimit] = useState('500');

  const verify = useMutation({
    mutationFn: (vars: { chainKey: string; limit: number }) =>
      apiGet<AdminAuditVerifyResult>('/api/admin/audit-logs/verify', {
        query: { chainKey: vars.chainKey, limit: vars.limit },
      }),
    retry: false,
    onSuccess: async () => {
      // 검사 자체가 새 감사 행을 만든다. 아래 목록이 그 행을 바로 보여줘야 앞뒤가 맞는다.
      await queryClient.invalidateQueries({ queryKey: qk.admin.all });
    },
  });

  const result = verify.data;
  const trimmed = chainKey.trim();

  return (
    <Panel
      title="체인 무결성 검사"
      description="감사 기록이 사후에 조작되지 않았음을 증명하는 검사입니다. 각 행이 직전 행의 해시를 품고 있어, 한 줄만 지우거나 고쳐도 연결이 끊어집니다."
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[14rem] flex-1">
            <label
              htmlFor="audit-chain-key"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              체인 샤드 (chainKey)
            </label>
            <Input
              id="audit-chain-key"
              value={chainKey}
              onChange={(event) => setChainKey(event.currentTarget.value)}
              placeholder="SYSTEM"
              autoComplete="off"
              spellCheck={false}
              className="h-9 font-mono"
            />
          </div>

          <FilterSelect
            label="검사 범위"
            value={limit}
            options={LIMIT_OPTIONS}
            onChange={setLimit}
            className="min-w-[7.5rem]"
          />

          <Button
            size="sm"
            className="h-9"
            loading={verify.isPending}
            disabled={trimmed.length === 0}
            onClick={() => verify.mutate({ chainKey: trimmed, limit: Number(limit) })}
          >
            검사 실행
          </Button>
        </div>

        <ChipGroup>
          {QUICK_KEYS.map((key) => (
            <Chip key={key} selected={trimmed === key} onClick={() => setChainKey(key)}>
              {key}
            </Chip>
          ))}
        </ChipGroup>

        <p className="text-xs text-muted-foreground">
          이 샤드의 <strong>가장 오래된 행부터</strong> 최대 {formatNumber(Number(limit))}행을 순서대로
          훑습니다. 이벤트 단위 샤드는{' '}
          <code className="rounded bg-muted px-1 py-0.5 font-mono">event:이벤트ID</code> 형식으로 직접
          적으세요. 검사를 실행한 사실도 감사 로그에 남습니다.
        </p>

        {verify.isError ? <Notice tone="danger">{toUserMessage(verify.error)}</Notice> : null}

        {result ? <VerifyResult result={result} /> : null}
      </div>
    </Panel>
  );
}

/** 결과 배너. 초록이면 연결이 온전하고, 빨강이면 어긋난 행을 그대로 보여준다. */
function VerifyResult({ result }: { result: AdminAuditVerifyResult }) {
  if (result.checked === 0) {
    return (
      <Notice tone="warning" title="검사할 기록이 없습니다">
        <code className="font-mono">{result.chainKey}</code> 샤드에 아직 행이 하나도 없습니다. 샤드
        이름을 잘못 적었는지 확인해 주세요.
      </Notice>
    );
  }

  if (result.intact) {
    return (
      <div className="flex gap-2.5 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm leading-relaxed">
        <ShieldCheck
          className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="font-bold text-emerald-700 dark:text-emerald-300">
            무결합니다 — 연결이 처음부터 끝까지 이어집니다
          </p>
          <p className="mt-0.5 text-muted-foreground">
            <code className="font-mono">{result.chainKey}</code> 샤드의{' '}
            {formatNumber(result.checked)}행을 확인했고, 끊긴 곳이 없습니다. 검사 구간은 seq{' '}
            <code className="font-mono tabular-nums">{result.firstSeq}</code> ~{' '}
            <code className="font-mono tabular-nums">{result.lastSeq}</code> 입니다.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="rounded-lg border-2 border-destructive/50 bg-destructive/5 p-3 text-sm leading-relaxed"
    >
      <div className="flex gap-2.5">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-bold text-destructive">
            연결이 끊어졌습니다 — {formatNumber(result.breaks.length)}곳
          </p>
          <p className="mt-0.5 text-muted-foreground">
            <code className="font-mono">{result.chainKey}</code> 샤드의{' '}
            {formatNumber(result.checked)}행 중 아래 행에서 직전 행의 해시와 값이 맞지 않습니다.
            행이 지워졌거나, 끼워 넣어졌거나, 같은 자리에 두 행이 갈라졌다는 뜻입니다.{' '}
            <strong className="text-foreground">
              지금 조치하지 말고 먼저 이 화면을 그대로 보존해 보고하세요.
            </strong>
          </p>
        </div>
      </div>

      <div className="mt-3 overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[34rem] border-collapse text-xs">
          <thead>
            <tr className="border-b bg-muted/40 text-left">
              <th scope="col" className="px-3 py-2 font-semibold text-muted-foreground">
                어긋난 행 (seq)
              </th>
              <th scope="col" className="px-3 py-2 font-semibold text-muted-foreground">
                기대한 prevHash
              </th>
              <th scope="col" className="px-3 py-2 font-semibold text-muted-foreground">
                실제 prevHash
              </th>
            </tr>
          </thead>
          <tbody>
            {result.breaks.map((item) => (
              <tr key={item.seq} className="border-b last:border-b-0">
                <td className="px-3 py-2 font-mono font-bold tabular-nums">{item.seq}</td>
                <td className="break-all px-3 py-2 font-mono text-muted-foreground">
                  {item.expectedPrevHash ?? '(없음 — 체인 시작)'}
                </td>
                <td className="break-all px-3 py-2 font-mono">
                  {item.actualPrevHash ?? '(없음)'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
