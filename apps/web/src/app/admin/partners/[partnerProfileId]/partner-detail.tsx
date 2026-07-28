'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

import { Badge, ErrorState, Skeleton } from '@/components/ui';
import { apiGet, toUserMessage } from '@/lib/api-client';
import { labelOf } from '@/lib/format';
import { qk } from '@/lib/query-keys';

import {
  AdminPage,
  AuditNotice,
  CopyableId,
  KeyValue,
  KeyValueGrid,
  Maybe,
  Notice,
  Panel,
  SlaBadge,
  TimeCell,
} from '../../_components/console';
import { PartnerActions } from '../../_components/partner-actions';
import {
  ACCOUNT_STATUS_LABEL,
  ACCOUNT_STATUS_TONE,
  BUSINESS_STATUS_LABEL,
  BUSINESS_STATUS_TONE,
  BUSINESS_TYPE_LABEL,
  PARTNER_APPROVAL_LABEL,
  PARTNER_APPROVAL_TONE,
  PARTNER_REJECTION_LABEL,
  USER_ROLE_LABEL,
} from '../../_lib/labels';
import type { AdminPartnerDetail } from '../../_lib/types';

/**
 * 파트너 신청서 상세.
 *
 * 목록에 없는 정보(연락처, 약관 동의 시각, 사업자 현황)를 여기서만 보여준다.
 * 큐에 다 실으면 여러 명이 동시에 열어 두는 화면에 개인정보가 상시 떠 있게 된다.
 */
export function PartnerDetail({ profileId }: { profileId: string }) {
  const query = useQuery({
    queryKey: qk.admin.partnerDetail(profileId),
    queryFn: () => apiGet<AdminPartnerDetail>(`/api/admin/partners/${profileId}`),
  });

  if (query.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <ErrorState
        title="신청서를 불러오지 못했어요"
        description={toUserMessage(query.error)}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const partner = query.data;

  return (
    <AdminPage
      back={{ href: '/admin/partners', label: '파트너 심사 큐' }}
      title={partner.contactName}
      description={partner.contactEmail}
      actions={
        <Badge variant={PARTNER_APPROVAL_TONE[partner.approvalStatus] ?? 'muted'}>
          {labelOf(PARTNER_APPROVAL_LABEL, partner.approvalStatus)}
        </Badge>
      }
    >
      <AuditNotice />

      {partner.approvalStatus === 'REJECTED' && partner.rejectionReason ? (
        <Notice tone="danger" title={`반려됨 · ${labelOf(PARTNER_REJECTION_LABEL, partner.rejectionCode)}`}>
          {partner.rejectionReason}
        </Notice>
      ) : null}

      {partner.approvalStatus === 'SUSPENDED' && partner.suspensionReason ? (
        <Notice tone="danger" title="활동 정지 중">
          {partner.suspensionReason}
        </Notice>
      ) : null}

      {partner.user.status === 'SUSPENDED' ? (
        <Notice tone="warning" title="이 파트너의 계정이 정지 상태입니다">
          파트너 승인과 별개로 계정 자체가 막혀 있어 로그인할 수 없습니다.{' '}
          <Link href={`/admin/users/${partner.userId}`} className="font-semibold underline">
            계정 화면에서 확인
          </Link>
        </Notice>
      ) : null}

      <Panel title="조치">
        <PartnerActions
          profileId={partner.id}
          status={partner.approvalStatus}
          onDone={() => void query.refetch()}
        />
      </Panel>

      <Panel title="신청 정보">
        <KeyValueGrid>
          <KeyValue label="담당자">{partner.contactName}</KeyValue>
          <KeyValue label="연락 이메일">{partner.contactEmail}</KeyValue>
          <KeyValue label="연락처">
            <Maybe value={partner.contactPhone} />
          </KeyValue>
          <KeyValue label="재제출 횟수">{partner.resubmitCount}회</KeyValue>
          <KeyValue label="제출">
            <TimeCell value={partner.submittedAt} />
          </KeyValue>
          <KeyValue label="SLA 기한">
            <SlaBadge dueAt={partner.slaDueAt} />
          </KeyValue>
          <KeyValue label="파트너 약관">
            <Maybe value={partner.partnerTermsVersion} />
            {partner.partnerTermsAgreedAt ? (
              <span className="ml-2 text-xs text-muted-foreground">
                동의 <TimeCell value={partner.partnerTermsAgreedAt} relative={false} />
              </span>
            ) : null}
          </KeyValue>
          <KeyValue label="신청서 ID">
            <CopyableId value={partner.id} />
          </KeyValue>
        </KeyValueGrid>
      </Panel>

      <Panel title="심사 이력">
        <KeyValueGrid>
          <KeyValue label="승인">
            <TimeCell value={partner.approvedAt} />
          </KeyValue>
          <KeyValue label="승인 처리자">
            <CopyableId value={partner.approvedByUserId} />
          </KeyValue>
          <KeyValue label="반려">
            <TimeCell value={partner.rejectedAt} />
          </KeyValue>
          <KeyValue label="반려 코드">
            {partner.rejectionCode ? labelOf(PARTNER_REJECTION_LABEL, partner.rejectionCode) : '-'}
          </KeyValue>
          <KeyValue label="정지">
            <TimeCell value={partner.suspendedAt} />
          </KeyValue>
          <KeyValue label="자격 박탈">
            <TimeCell value={partner.revokedAt} />
          </KeyValue>
          <KeyValue label="반려 사유" full>
            <Maybe value={partner.rejectionReason} />
          </KeyValue>
        </KeyValueGrid>
        <p className="mt-2 text-xs text-muted-foreground">
          누가 언제 무엇을 했는지의 전체 기록은{' '}
          <Link
            href={`/admin/audit-logs?targetType=PARTNER_PROFILE&targetId=${partner.id}`}
            className="font-semibold text-primary hover:underline"
          >
            감사 로그
          </Link>
          에 있습니다.
        </p>
      </Panel>

      <Panel title="연결된 계정">
        <KeyValueGrid>
          <KeyValue label="닉네임">
            <Link href={`/admin/users/${partner.user.id}`} className="font-semibold hover:underline">
              {partner.user.displayName}
            </Link>
          </KeyValue>
          <KeyValue label="계정 이메일">
            <Maybe value={partner.user.email} />
          </KeyValue>
          <KeyValue label="계정 상태">
            <Badge variant={ACCOUNT_STATUS_TONE[partner.user.status] ?? 'muted'}>
              {labelOf(ACCOUNT_STATUS_LABEL, partner.user.status)}
            </Badge>
          </KeyValue>
          <KeyValue label="역할">
            <span className="flex flex-wrap gap-1">
              {partner.user.roles.map((role) => (
                <Badge key={role} variant="outline" size="sm">
                  {labelOf(USER_ROLE_LABEL, role)}
                </Badge>
              ))}
            </span>
          </KeyValue>
        </KeyValueGrid>
      </Panel>

      <Panel
        title="등록된 사업자"
        description="사업자 진위 확인은 사업자 심사 화면에서 처리합니다."
        bodyClassName={partner.businesses.length === 0 ? 'p-4' : 'p-0'}
      >
        {partner.businesses.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            아직 등록된 사업자가 없습니다. 사업자가 확인되지 않으면 시설 검수를 통과할 수 없어요.
          </p>
        ) : (
          <ul className="divide-y">
            {partner.businesses.map((business) => (
              <li key={business.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                <Link
                  href={`/admin/businesses/${business.id}`}
                  className="min-w-0 flex-1 font-semibold hover:underline"
                >
                  {business.name}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {business.legalName}
                  </span>
                </Link>
                <Badge variant="outline" size="sm">
                  {labelOf(BUSINESS_TYPE_LABEL, business.businessType)}
                </Badge>
                <Badge variant={BUSINESS_STATUS_TONE[business.verificationStatus] ?? 'muted'}>
                  {labelOf(BUSINESS_STATUS_LABEL, business.verificationStatus)}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </AdminPage>
  );
}
