'use client';

import { useId, useMemo } from 'react';

import { Select } from '@/components/ui';
import { labelOf } from '@/lib/format';

import { AUDIT_ACTION_LABEL } from '../../_lib/labels';

/**
 * 액션 필터.
 *
 * 감사 액션은 60개가 넘는다. 하나의 평평한 드롭다운으로 두면 운영자가 찾는 항목이
 * 어디쯤 있는지 감이 안 잡히고, 결국 필터를 안 쓰게 된다. 그래서 **도메인별로 묶는다** —
 * "파트너 관련 조치를 훑고 싶다"가 실제 사용 패턴이기 때문이다.
 *
 * 묶음은 `optgroup` 으로 만든다. 커스텀 드롭다운을 만들지 않은 이유는 콘솔의 다른
 * 필터와 같다 — 네이티브가 키보드 첫 글자 점프와 스크린리더 그룹 읽기를 공짜로 준다.
 */

/**
 * 도메인 → 액션 키. 서버 enum 을 그대로 옮긴 `AUDIT_ACTION_LABEL` 을 나눈 것이라
 * 여기 없는 키가 생길 수 있다. 그런 키는 아래에서 "기타"로 자동 수집한다 —
 * 목록에서 조용히 사라지면 그 액션은 영영 필터링할 수 없게 된다.
 */
const ACTION_GROUPS: Array<{ title: string; keys: string[] }> = [
  {
    title: '파트너 · 사업자',
    keys: [
      'PARTNER_APPLIED',
      'PARTNER_APPLICATION_CLAIMED',
      'PARTNER_APPLICATION_APPROVED',
      'PARTNER_APPLICATION_REJECTED',
      'PARTNER_APPLICATION_MORE_INFO',
      'PARTNER_APPROVED',
      'PARTNER_REJECTED',
      'PARTNER_SUSPENDED',
      'PARTNER_REVOKED',
      'PARTNER_REINSTATED',
      'BUSINESS_SUBMITTED',
      'BUSINESS_VERIFIED',
      'BUSINESS_REJECTED',
      'BUSINESS_REVOKED',
      'REGISTRATION_DOC_VIEWED',
      'PARTNER_USER_BLOCKED',
      'PARTNER_USER_UNBLOCKED',
    ],
  },
  {
    title: '시설',
    keys: [
      'VENUE_SUBMITTED',
      'VENUE_PUBLISHED',
      'VENUE_HIDDEN',
      'VENUE_SUSPENDED',
      'VENUE_ARCHIVED',
      'VENUE_IMAGE_QUARANTINED',
      'CONTENT_HIDDEN',
      'CONTENT_RESTORED',
    ],
  },
  {
    title: '이벤트',
    keys: [
      'EVENT_FORCE_CLOSED',
      'EVENT_FORCE_CANCELED',
      'EVENT_UNPUBLISHED',
      'EVENT_RESTORED',
      'EVENT_DEADLINE_EXTENDED',
      'EVENT_CAPACITY_EDITED',
      'PARTNER_DEADLINE_EXTENDED',
      'PARTNER_EVENT_CANCELED',
    ],
  },
  {
    // 순위·예약금 만료는 명단을 바꾸는 일이라 여기 둔다 (D-04 · D-05).
    title: '명단 · 순위',
    keys: [
      'EVENT_FINAL_LIST_RESET',
      'PARTNER_FINAL_LIST_EDITED',
      'PARTNER_SELECTION_OVERRIDE',
      'PARTNER_APPLICANT_REMOVED',
      'SYSTEM_RANKING_FINALIZED',
      'SYSTEM_REBID_ROLLED_BACK',
      'SYSTEM_SWEEP_EXPIRED_HOLDS',
    ],
  },
  {
    title: '공지 · 이메일',
    keys: [
      'BROADCAST_CREATED',
      'BROADCAST_APPROVED',
      'BROADCAST_SENT',
      'BROADCAST_CANCELED',
      'BROADCAST_MODERATION_BLOCKED',
      'EMAIL_SUPPRESSION_RELEASED',
      'EMAIL_DELIVERY_RESENT',
    ],
  },
  {
    title: '계정 · 개인정보',
    keys: [
      'ACCOUNT_SUSPENDED',
      'ACCOUNT_SUSPENSION_LIFTED',
      'ACCOUNT_ROLE_CHANGED',
      'ACCOUNT_ANONYMIZED',
      'PII_ACCESSED',
      'ADMIN_INVITED',
      'ADMIN_ACTIVATED',
      'ADMIN_DEACTIVATED',
      'ADMIN_PERMISSION_CHANGED',
      'ADMIN_LOGIN',
    ],
  },
  {
    title: '시스템 · 설정',
    keys: [
      'SETTING_CHANGED',
      'FEATURE_FLAG_TOGGLED',
      'CATEGORY_CREATED',
      'CATEGORY_UPDATED',
      'CATEGORY_MERGED',
      'CATEGORY_DEACTIVATED',
      'REGION_UPDATED',
      'FEE_POLICY_CREATED',
      'FEE_POLICY_ENDED',
      'SETTLEMENT_COMPUTED',
      'SETTLEMENT_STATUS_CHANGED',
      'AUDIT_EXPORTED',
      'SYSTEM_AUDIT_CHAIN_VERIFIED',
    ],
  },
];

export function ActionFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();

  // 사전에는 있는데 어느 묶음에도 안 들어간 키를 마지막에 모은다.
  const groups = useMemo(() => {
    const claimed = new Set(ACTION_GROUPS.flatMap((group) => group.keys));
    const rest = Object.keys(AUDIT_ACTION_LABEL).filter((key) => !claimed.has(key));

    return rest.length > 0 ? [...ACTION_GROUPS, { title: '기타', keys: rest }] : ACTION_GROUPS;
  }, []);

  return (
    <div className="min-w-[13rem]">
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted-foreground">
        액션
      </label>
      <Select
        id={id}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        className="h-9 text-sm"
      >
        <option value="">전체 액션</option>
        {groups.map((group) => (
          <optgroup key={group.title} label={group.title}>
            {group.keys.map((key) => (
              <option key={key} value={key}>
                {labelOf(AUDIT_ACTION_LABEL, key)}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
    </div>
  );
}
