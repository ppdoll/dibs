'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { PartnerShell } from '@/components/layout';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardRow, CardTitle } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { PARTNER_APPROVAL_LABEL, formatFullDateTimeKo, formatNumber, labelOf } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { getPartnerProfile } from '../_lib/api';
import { InfoNote, PartnerPageHeader } from '../_components/partner-page';
import { toPartnerMessage } from '../_lib/errors';

/**
 * 파트너 정보 화면.
 *
 * 읽기 전용이다 — 이 프로필을 고치는 엔드포인트는 없다(신청서 제출은 인증 모듈,
 * 승인·정지는 운영자 모듈이 갖는다). 그래서 화면도 "지금 어떤 상태이고 다음에
 * 무엇을 하면 되는가" 만 답한다.
 */
export function ProfileView() {
  return (
    <PartnerShell allowUnapproved>
      <ProfileBody />
    </PartnerShell>
  );
}

function ProfileBody() {
  const profile = useQuery({
    queryKey: qk.partner.profile,
    queryFn: getPartnerProfile,
    staleTime: 30_000,
  });

  if (profile.isLoading) {
    return (
      <>
        <Skeleton className="mb-6 h-8 w-40" />
        <Skeleton className="mb-4 h-48" />
        <Skeleton className="h-64" />
      </>
    );
  }

  if (profile.isError) {
    return (
      <ErrorState
        title="파트너 정보를 불러오지 못했어요"
        description={toPartnerMessage(profile.error)}
        onRetry={() => void profile.refetch()}
      />
    );
  }

  const me = profile.data;
  if (!me) return null;

  const needsAction =
    me.approvalStatus === 'DRAFT' ||
    me.approvalStatus === 'REJECTED' ||
    me.approvalStatus === 'RESUBMIT_REQUIRED';

  return (
    <>
      <PartnerPageHeader
        title="파트너 정보"
        description="심사 상태와 등록 현황을 한눈에 볼 수 있어요."
        badge={
          <Badge variant={me.canOperate ? 'success' : 'warning'}>
            {labelOf(PARTNER_APPROVAL_LABEL, me.approvalStatus)}
          </Badge>
        }
        actions={
          needsAction ? (
            <Link href="/partner/apply" className={buttonVariants({ variant: 'primary' })}>
              신청서 작성하기
            </Link>
          ) : null
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>심사</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y">
              <CardRow label="상태" value={labelOf(PARTNER_APPROVAL_LABEL, me.approvalStatus)} />
              <CardRow label="신청서 제출" value={formatFullDateTimeKo(me.submittedAt)} />
              <CardRow label="심사 기한" value={formatFullDateTimeKo(me.slaDueAt)} />
              <CardRow label="승인" value={formatFullDateTimeKo(me.approvedAt)} />
              <CardRow label="재제출 횟수" value={`${formatNumber(me.resubmitCount)}회`} />
            </dl>

            {me.rejectionReason ? (
              <InfoNote className="mt-4" title="반려 사유">
                {me.rejectionReason}
              </InfoNote>
            ) : null}

            {me.suspensionReason ? (
              <InfoNote className="mt-4" title="활동 정지 사유">
                {me.suspensionReason}
              </InfoNote>
            ) : null}

            {me.approvalStatus === 'PENDING' ? (
              <InfoNote className="mt-4">
                심사가 끝나면 알림과 메일로 알려드려요. 심사 기한이 지났는데 소식이 없으면
                고객센터로 문의해 주세요.
              </InfoNote>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>담당자</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y">
              <CardRow label="이름" value={me.contactName} />
              <CardRow label="이메일" value={me.contactEmail} />
              <CardRow label="연락처" value={me.contactPhone ?? '-'} />
              <CardRow
                label="파트너 약관"
                value={
                  me.partnerTermsAgreedAt
                    ? `${me.partnerTermsVersion ?? ''} · ${formatFullDateTimeKo(me.partnerTermsAgreedAt)}`
                    : '동의 이력 없음'
                }
              />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>사업자</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y">
              <CardRow label="전체" value={`${formatNumber(me.businesses.total)}곳`} />
              <CardRow label="확인 완료" value={`${formatNumber(me.businesses.verified)}곳`} />
              <CardRow label="심사 중" value={`${formatNumber(me.businesses.pending)}곳`} />
              <CardRow label="조치 필요" value={`${formatNumber(me.businesses.actionRequired)}곳`} />
            </dl>
            <Link
              href="/partner/businesses"
              className={`${buttonVariants({ variant: 'outline', size: 'sm' })} mt-4`}
            >
              사업자 관리
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>시설</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y">
              <CardRow label="전체" value={`${formatNumber(me.venues.total)}곳`} />
              <CardRow label="노출 중" value={`${formatNumber(me.venues.active)}곳`} />
              <CardRow label="검수 중" value={`${formatNumber(me.venues.pendingReview)}곳`} />
              <CardRow label="작성 중" value={`${formatNumber(me.venues.draft)}곳`} />
              <CardRow label="노출 중단 · 보관" value={`${formatNumber(me.venues.hidden + me.venues.archived)}곳`} />
            </dl>
            <Link
              href="/partner/venues"
              className={`${buttonVariants({ variant: 'outline', size: 'sm' })} mt-4`}
            >
              시설 관리
            </Link>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
