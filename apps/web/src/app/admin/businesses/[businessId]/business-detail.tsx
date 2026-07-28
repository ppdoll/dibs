'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Eye, EyeOff, FileText } from 'lucide-react';

import { Badge, Button, ErrorState, Skeleton } from '@/components/ui';
import { apiGet, toUserMessage } from '@/lib/api-client';
import { labelOf } from '@/lib/format';

import {
  AdminPage,
  CopyableId,
  KeyValue,
  KeyValueGrid,
  Maybe,
  Notice,
  Panel,
  TimeCell,
} from '../../_components/console';
import { BusinessActions } from '../../_components/business-actions';
import {
  BUSINESS_STATUS_LABEL,
  BUSINESS_STATUS_TONE,
  BUSINESS_TYPE_LABEL,
  PARTNER_APPROVAL_LABEL,
} from '../../_lib/labels';
import type { AdminBusinessDetail } from '../../_lib/types';

/** 123-45-67890 → 123-45-6**** */
function maskBrn(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 10) return raw;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5, 6)}****`;
}

function formatBrn(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 10) return raw;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

/**
 * 사업자 상세.
 *
 * 이 화면을 여는 것 자체가 개인정보 열람이라 서버가 `PII_ACCESSED` 를 남긴다.
 * 그래서 화면 맨 위에 그 사실을 적고, 등록번호는 기본적으로 가려 둔다 —
 * 감사 기록이 남는 것과 옆자리 사람이 화면을 보는 것은 다른 문제다.
 */
export function BusinessDetail({ businessId }: { businessId: string }) {
  const [revealed, setRevealed] = useState(false);

  const query = useQuery({
    /**
     * 캐시 키를 일부러 `admin` 접두사 **바깥**에 둔다.
     *
     * 조치가 끝나면 콘솔은 `qk.admin.all` 을 통째로 무효화하는데, 이 조회는 그때마다
     * `PII_ACCESSED` 감사 행을 하나씩 더 만든다. 콘솔 어딘가에서 버튼을 누를 때마다
     * 열지도 않은 사업자의 열람 기록이 쌓이면, 그 로그로는 진짜 열람을 골라낼 수 없다.
     */
    queryKey: ['admin-pii', 'businesses', businessId],
    queryFn: () => apiGet<AdminBusinessDetail>(`/api/admin/businesses/${businessId}`),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  if (query.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <ErrorState
        title="사업자 정보를 불러오지 못했어요"
        description={toUserMessage(query.error)}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const business = query.data;

  return (
    <AdminPage
      back={{ href: '/admin/businesses', label: '사업자 확인 큐' }}
      title={business.name}
      description={business.legalName}
      actions={
        <Badge variant={BUSINESS_STATUS_TONE[business.verificationStatus] ?? 'muted'}>
          {labelOf(BUSINESS_STATUS_LABEL, business.verificationStatus)}
        </Badge>
      }
    >
      <Notice tone="warning" title="개인정보 열람이 기록되었습니다">
        이 화면을 연 시각과 계정이 감사 로그에{' '}
        <code className="font-mono text-xs">PII_ACCESSED</code> 로 남았습니다.
      </Notice>

      {business.verificationStatus === 'REJECTED' && business.verificationRejectionReason ? (
        <Notice tone="danger" title="반려됨">
          {business.verificationRejectionReason}
        </Notice>
      ) : null}

      <Panel title="조치">
        <BusinessActions
          businessId={business.id}
          status={business.verificationStatus}
          onDone={() => void query.refetch()}
        />
      </Panel>

      <Panel title="사업자 정보">
        <KeyValueGrid>
          <KeyValue label="사업자등록번호">
            <span className="inline-flex items-center gap-2">
              <code className="font-mono text-sm">
                {revealed
                  ? formatBrn(business.businessRegistrationNumber)
                  : maskBrn(business.businessRegistrationNumber)}
              </code>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setRevealed((prev) => !prev)}
                leadingIcon={
                  revealed ? (
                    <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                  )
                }
              >
                {revealed ? '가리기' : '전체 보기'}
              </Button>
            </span>
          </KeyValue>
          <KeyValue label="사업자 유형">
            {labelOf(BUSINESS_TYPE_LABEL, business.businessType)}
          </KeyValue>
          <KeyValue label="대표자명">
            <Maybe value={business.representativeName} />
          </KeyValue>
          <KeyValue label="연락처">
            <Maybe value={business.contactPhone} />
          </KeyValue>
          <KeyValue label="연락 이메일">
            <Maybe value={business.contactEmail} />
          </KeyValue>
          <KeyValue label="우편번호">
            <Maybe value={business.postalCode} />
          </KeyValue>
          <KeyValue label="주소" full>
            <Maybe value={business.roadAddress} />
            {business.detailAddress ? (
              <span className="text-muted-foreground"> {business.detailAddress}</span>
            ) : null}
          </KeyValue>
        </KeyValueGrid>
      </Panel>

      <Panel title="사업자등록증">
        {business.hasRegistrationDoc ? (
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm">
              <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              등록증이 업로드되어 있습니다.
            </p>
            <Notice tone="info">
              운영자용 등록증 열람 엔드포인트가 아직 없습니다. 지금은 파트너 본인만 60초짜리
              서명 URL 로 열 수 있어요(그 열람도{' '}
              <code className="font-mono text-xs">REGISTRATION_DOC_VIEWED</code> 로 감사됩니다).
              운영자가 원본을 봐야 한다면 같은 방식의 운영자 전용 경로가 필요합니다.
            </Notice>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            아직 등록증이 올라오지 않았습니다. 서류 없이 확인 완료하면 근거가 남지 않으니,
            필요하면 반려 후 재제출을 받으세요.
          </p>
        )}
      </Panel>

      <Panel title="심사 이력">
        <KeyValueGrid>
          <KeyValue label="심사 제출">
            <TimeCell value={business.verificationSubmittedAt} />
          </KeyValue>
          <KeyValue label="확인 완료">
            <TimeCell value={business.verifiedAt} />
          </KeyValue>
          <KeyValue label="확인 처리자">
            <CopyableId value={business.verifiedByUserId} />
          </KeyValue>
          <KeyValue label="등록일">
            <TimeCell value={business.createdAt} />
          </KeyValue>
          <KeyValue label="반려 사유" full>
            <Maybe value={business.verificationRejectionReason} />
          </KeyValue>
        </KeyValueGrid>
        <p className="mt-2 text-xs text-muted-foreground">
          <Link
            href={`/admin/audit-logs?targetType=BUSINESS&targetId=${business.id}`}
            className="font-semibold text-primary hover:underline"
          >
            이 사업자의 감사 로그 보기
          </Link>
        </p>
      </Panel>

      <Panel title="소유 파트너">
        <KeyValueGrid>
          <KeyValue label="담당자">
            <Link
              href={`/admin/partners/${business.partner.id}`}
              className="font-semibold hover:underline"
            >
              {business.partner.contactName}
            </Link>
          </KeyValue>
          <KeyValue label="파트너 상태">
            {labelOf(PARTNER_APPROVAL_LABEL, business.partner.approvalStatus)}
          </KeyValue>
          <KeyValue label="계정">
            <Link
              href={`/admin/users/${business.partner.userId}`}
              className="text-primary hover:underline"
            >
              계정 상세 열기
            </Link>
          </KeyValue>
        </KeyValueGrid>
      </Panel>
    </AdminPage>
  );
}
