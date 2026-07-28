'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';

import { ErrorState, SkeletonList } from '@/components/ui';
import { apiGet, toUserMessage } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';

import { AdminPage, Notice, Panel } from '../_components/console';
import type { AdminList, AdminSettingRow } from '../_lib/types';
import { SettingCard } from './_components/setting-card';

/**
 * 설정 · 피처 플래그. (IC-65)
 *
 * 이 화면의 값들은 env 가 아니라 테이블에 있다. 재배포 없이 끌 수 있어야 하고,
 * 누가 언제 껐는지가 남아야 하기 때문이다. 그래서 화면의 성격도 "설정 폼"보다는
 * **조치 화면**에 가깝다 — 모든 변경이 확인 창을 거치고 감사 로그에 남는다.
 *
 * 저장된 행이 없는 키도 "코드 기본값"으로 함께 나온다. 목록에 안 보이는 플래그는
 * 존재하지 않는 플래그가 되고, 그러면 아무도 그것이 꺼져 있다는 사실을 모른다.
 */

/** 파급이 압도적으로 커서 별도 카드로 뽑는 키. (D-05) */
const DEPOSIT_HOLD_KEY = 'DEPOSIT_HOLD_ENABLED';

export default function AdminSettingsPage() {
  const query = useQuery({
    queryKey: qk.admin.settings,
    queryFn: () => apiGet<AdminList<AdminSettingRow>>('/api/admin/settings'),
  });

  const items = query.data?.items ?? [];
  const depositHold = items.find((item) => item.key === DEPOSIT_HOLD_KEY);
  const flags = items.filter((item) => item.isFeatureFlag && item.key !== DEPOSIT_HOLD_KEY);
  const others = items.filter((item) => !item.isFeatureFlag);

  return (
    <AdminPage
      title="설정 · 피처 플래그"
      description="재배포 없이 바꿀 수 있는 런타임 값입니다. 저장하면 이 인스턴스에는 즉시, 나머지 서버 인스턴스에는 최대 30초 뒤에 반영됩니다."
    >
      <Notice tone="info" title="모든 변경은 감사 로그에 남습니다">
        피처 플래그는 <code className="font-mono">FEATURE_FLAG_TOGGLED</code>, 그 밖의 설정은{' '}
        <code className="font-mono">SETTING_CHANGED</code> 로 기록됩니다. 변경 전후 값과 사유가 함께
        남으므로, &ldquo;이 값이 언제부터 이랬는지&rdquo;는 감사 로그만 보고 재구성할 수 있어요.
      </Notice>

      {query.isPending ? (
        <SkeletonList count={5} />
      ) : query.isError ? (
        <ErrorState
          title="설정을 불러오지 못했어요"
          description={toUserMessage(query.error)}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <div className="space-y-4">
          {depositHold ? <DepositHoldPanel row={depositHold} /> : null}

          <Panel
            title="피처 플래그"
            description="켜고 끄는 것만으로 서비스 동작이 바뀝니다. 끄는 쪽이 항상 안전한 기본값이에요."
          >
            {flags.length > 0 ? (
              <div className="space-y-3">
                {flags.map((row) => (
                  <SettingCard key={row.key} row={row} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                등록된 플래그가 없습니다. 새 플래그는 서버의{' '}
                <code className="font-mono">SETTING_REGISTRY</code> 에 먼저 추가해야 여기에 보여요.
              </p>
            )}
          </Panel>

          <Panel
            title="일반 설정"
            description="숫자·문자열 값입니다. JSON 원문 그대로 저장되므로 따옴표 유무까지 정확해야 합니다."
          >
            {others.length > 0 ? (
              <div className="space-y-3">
                {others.map((row) => (
                  <SettingCard key={row.key} row={row} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">등록된 설정이 없습니다.</p>
            )}
          </Panel>
        </div>
      )}
    </AdminPage>
  );
}

/**
 * ★ DEPOSIT_HOLD_ENABLED 전용 카드. (D-05)
 *
 * 이 플래그 하나가 신청 흐름 전체를 바꾼다. 켜면 신청이 곧바로 확정되지 않고
 * 예약금 납부를 기다리는 상태가 되는데, **실제 결제(PG) 연동이 아직 없다.**
 * 그래서 운영 환경에서 켜면 아무도 예약금을 낼 수 없고, 결과적으로 모든 신청이
 * 10분 뒤 만료된다 — 서비스를 멈추는 것과 같다. 그 사실을 스위치 옆에 적어 둔다.
 */
function DepositHoldPanel({ row }: { row: AdminSettingRow }) {
  const enabled = row.value === true;

  return (
    <section className="rounded-lg border-2 border-amber-500/50 bg-amber-500/5">
      <header className="flex items-start gap-2.5 border-b border-amber-500/30 px-4 py-3">
        <AlertTriangle
          className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <h2 className="text-sm font-bold">예약금 홀드 — 가장 파급이 큰 플래그</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            켜는 순간 신청 흐름이 통째로 바뀝니다. 켜기 전에 아래 두 문단을 반드시 읽으세요.
          </p>
        </div>
      </header>

      <div className="space-y-3 p-4">
        <div className="rounded-lg border bg-card p-3 text-sm leading-relaxed">
          <p className="font-semibold">켜면 이렇게 동작합니다</p>
          <p className="mt-1 text-muted-foreground">
            신청한 뒤 <strong className="text-foreground">10분 안에 예약금을 내야</strong> 신청이
            유효해집니다. 선착순 즉시확정 이벤트는 잡아 둔 자리를 유지하고, 금액 입찰형 이벤트는
            순위 집계에 들어갑니다. 시간 안에 내지 않으면 홀드가 만료되어{' '}
            <strong className="text-foreground">자리가 반환</strong>되고, 입찰형은 랭킹에서
            빠집니다. 순위를 정하는 값은 어디까지나 <em>신청 금액</em>이며 낸 예약금 액수가 아닙니다
            — 예약금은 진지함을 증명하는 자격 요건일 뿐입니다.
          </p>
        </div>

        <Notice tone="danger" title="지금 운영 환경에서 켜면 신청이 전부 막힙니다">
          실제 결제(PG) 연동은 아직 구현되지 않았습니다. 상태·타이머·테이블 구조만 만들어 둔
          단계라, 켜 두면 이용자가 예약금을 낼 방법이 없고 모든 신청이 10분 뒤 만료됩니다.{' '}
          <strong>결제 연동이 붙기 전까지는 꺼진 상태가 정상입니다.</strong> 개발·스테이징에서
          타이머와 만료 스위퍼를 확인할 때만 켜세요.
        </Notice>

        {enabled ? (
          <Notice tone="warning">
            지금 <strong>켜져 있습니다.</strong> 의도한 상태가 맞는지 확인해 주세요.
          </Notice>
        ) : null}

        <div className="rounded-lg border bg-card p-4">
          <SettingCard
            row={row}
            bare
            confirmWarning={
              enabled ? (
                <>
                  끄면 새로 들어오는 신청은 예약금 없이 곧바로 유효해집니다. 이미 열려 있는
                  홀드는 그대로 남아 만료 시각까지 살아 있습니다.
                </>
              ) : (
                <>
                  켜면 이 시점 이후의 모든 신청이 &ldquo;예약금 납부 대기&rdquo; 상태로 들어갑니다.
                  결제 수단이 아직 없으므로 이용자는 납부할 방법이 없고, 10분 뒤 전부 만료됩니다.
                  운영 환경이라면 켜지 마세요.
                </>
              )
            }
          />
        </div>
      </div>
    </section>
  );
}
