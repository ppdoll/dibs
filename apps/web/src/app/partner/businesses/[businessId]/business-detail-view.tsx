'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, FileCheck2, Trash2, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { PartnerShell } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardRow, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { formatFullDateTimeKo, formatNumber } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import {
  attachBusinessDoc,
  createBusinessDocTicket,
  deleteBusiness,
  getBusiness,
  resolveBusinessDoc,
  submitBusinessVerification,
  updateBusiness,
} from '../../_lib/api';
import { BUSINESS_DOC_CONTENT_TYPES } from '../../_lib/types';
import { BUSINESS_TYPE_LABEL, BUSINESS_VERIFICATION_LABEL } from '../../_lib/labels';
import { BusinessForm, type BusinessFormValues } from '../../_components/business-form';
import {
  BusinessStatusBadge,
  ErrorBanner,
  InfoNote,
  PartnerPageHeader,
} from '../../_components/partner-page';
import { formatBytes, uploadToBlob } from '../../_lib/blob';
import { toPartnerMessage } from '../../_lib/errors';

/** 사업자등록증 상한. 서버(BUSINESS_DOC_MAX_BYTES)와 같은 값이다. */
const DOC_MAX_BYTES = 10 * 1024 * 1024;

/** 심사 중·확인 완료·승인취소면 내용을 고칠 수 없다. */
const EDITABLE_STATUSES = ['UNSUBMITTED', 'REJECTED'];

export function BusinessDetailView({ businessId }: { businessId: string }) {
  return (
    <PartnerShell>
      <BusinessDetailBody businessId={businessId} />
    </PartnerShell>
  );
}

function BusinessDetailBody({ businessId }: { businessId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();

  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const business = useQuery({
    queryKey: qk.partner.businesses.detail(businessId),
    queryFn: () => getBusiness(businessId),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: qk.partner.businesses.all });
    await queryClient.invalidateQueries({ queryKey: qk.partner.profile });
  };

  const update = useMutation({
    mutationFn: (values: BusinessFormValues) => updateBusiness(businessId, values),
    onSuccess: async () => {
      await invalidate();
      setEditing(false);
      success('사업자 정보를 저장했어요');
    },
  });

  const submitVerification = useMutation({
    mutationFn: () => submitBusinessVerification(businessId),
    onSuccess: async () => {
      await invalidate();
      setConfirmSubmit(false);
      success('심사를 요청했어요', '운영자 확인이 끝나면 알림으로 알려드릴게요.');
    },
    onError: (error) => toastError('심사를 요청하지 못했어요', toPartnerMessage(error)),
  });

  const remove = useMutation({
    mutationFn: () => deleteBusiness(businessId),
    onSuccess: async () => {
      await invalidate();
      success('사업자를 삭제했어요');
      router.push('/partner/businesses');
    },
    onError: (error) => toastError('삭제하지 못했어요', toPartnerMessage(error)),
  });

  /**
   * 등록증 열람.
   *
   * URL 은 만료가 60초라 상태로 들고 있지 않는다 — 화면에 남겨두면 새로고침 전까지
   * 죽은 링크가 붙어 있게 된다. 누를 때마다 새로 받아서 곧바로 연다.
   */
  const openDoc = useMutation({
    mutationFn: () => resolveBusinessDoc(businessId),
    onSuccess: (result) => window.open(result.url, '_blank', 'noopener,noreferrer'),
    onError: (error) => toastError('첨부 파일을 열지 못했어요', toPartnerMessage(error)),
  });

  /** 업로드 3단계: 티켓 발급 → Blob 직접 업로드 → 등록. 중간에 끊기면 처음부터 다시 한다. */
  const handleFile = async (file: File) => {
    setUploadError(null);

    if (!(BUSINESS_DOC_CONTENT_TYPES as readonly string[]).includes(file.type)) {
      setUploadError('PDF, JPG, PNG 파일만 올릴 수 있어요.');
      return;
    }
    if (file.size > DOC_MAX_BYTES) {
      setUploadError(`파일이 너무 커요. ${formatBytes(DOC_MAX_BYTES)} 이하로 올려 주세요.`);
      return;
    }

    setUploading(true);
    try {
      const ticket = await createBusinessDocTicket(businessId, file.type);
      const uploaded = await uploadToBlob({
        pathname: ticket.pathname,
        clientToken: ticket.clientToken,
        file,
      });
      await attachBusinessDoc(businessId, {
        pathname: ticket.pathname,
        blobUrl: uploaded.url,
      });
      await invalidate();
      success('사업자등록증을 올렸어요');
    } catch (error) {
      setUploadError(toPartnerMessage(error));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (business.isLoading) {
    return (
      <>
        <Skeleton className="mb-6 h-8 w-56" />
        <Skeleton className="mb-4 h-64" />
        <Skeleton className="h-40" />
      </>
    );
  }

  if (business.isError) {
    return (
      <ErrorState
        title="사업자 정보를 불러오지 못했어요"
        description={toPartnerMessage(business.error)}
        onRetry={() => void business.refetch()}
      />
    );
  }

  const data = business.data;
  if (!data) return null;

  const editable = EDITABLE_STATUSES.includes(data.verificationStatus);
  const canSubmitVerification = editable && data.hasRegistrationDoc;

  return (
    <div className="mx-auto max-w-3xl">
      <PartnerPageHeader
        title={data.name}
        description={`${data.legalName} · ${BUSINESS_TYPE_LABEL[data.businessType]}`}
        back={{ href: '/partner/businesses', label: '사업자 정보' }}
        badge={<BusinessStatusBadge status={data.verificationStatus} />}
        actions={
          editable && !editing ? (
            <Button variant="outline" onClick={() => setEditing(true)}>
              수정
            </Button>
          ) : null
        }
      />

      {data.verificationRejectionReason ? (
        <InfoNote className="mb-4" title="반려 사유">
          {data.verificationRejectionReason}
        </InfoNote>
      ) : null}

      {editing ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>사업자 정보 수정</CardTitle>
          </CardHeader>
          <CardContent>
            <BusinessForm
              initial={{
                name: data.name,
                legalName: data.legalName,
                businessRegistrationNumber: data.businessRegistrationNumber,
                businessType: data.businessType,
                representativeName: data.representativeName,
                contactEmail: data.contactEmail,
                contactPhone: data.contactPhone,
                ...(data.postalCode ? { postalCode: data.postalCode } : {}),
                ...(data.roadAddress ? { roadAddress: data.roadAddress } : {}),
                ...(data.detailAddress ? { detailAddress: data.detailAddress } : {}),
              }}
              submitLabel="저장하기"
              submitting={update.isPending}
              error={update.error}
              lockReviewedFields={!editable}
              onSubmit={(values) => update.mutate(values)}
              onCancel={() => setEditing(false)}
            />
          </CardContent>
        </Card>
      ) : (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>등록 정보</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y">
              <CardRow label="사업자등록번호" value={data.businessRegistrationNumber} />
              <CardRow label="대표자명" value={data.representativeName} />
              <CardRow label="담당자 이메일" value={data.contactEmail} />
              <CardRow label="담당자 연락처" value={data.contactPhone} />
              <CardRow
                label="사업장 주소"
                value={
                  data.roadAddress
                    ? `${data.postalCode ? `(${data.postalCode}) ` : ''}${data.roadAddress} ${data.detailAddress ?? ''}`.trim()
                    : '-'
                }
              />
              <CardRow label="연결된 시설" value={`${formatNumber(data.venueCount)}곳`} />
              <CardRow label="심사 제출" value={formatFullDateTimeKo(data.verificationSubmittedAt)} />
              <CardRow label="확인 완료" value={formatFullDateTimeKo(data.verifiedAt)} />
            </dl>
          </CardContent>
        </Card>
      )}

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>사업자등록증</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ErrorBanner message={uploadError} />

          <InfoNote>
            파일은 우리 서버를 거치지 않고 저장소로 바로 올라가요. 올린 뒤에는 열람 링크가
            60초만 유효하니, 필요할 때마다 다시 눌러 주세요.
          </InfoNote>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept={BUSINESS_DOC_CONTENT_TYPES.join(',')}
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />

            <Button
              variant="outline"
              loading={uploading}
              disabled={!editable}
              leadingIcon={<Upload className="h-4 w-4" aria-hidden="true" />}
              onClick={() => fileInputRef.current?.click()}
            >
              {data.hasRegistrationDoc ? '다시 올리기' : '등록증 올리기'}
            </Button>

            {data.hasRegistrationDoc ? (
              <Button
                variant="ghost"
                loading={openDoc.isPending}
                leadingIcon={<ExternalLink className="h-4 w-4" aria-hidden="true" />}
                onClick={() => openDoc.mutate()}
              >
                올린 파일 보기
              </Button>
            ) : null}
          </div>

          {!editable ? (
            <p className="text-sm text-muted-foreground">
              지금은 {BUSINESS_VERIFICATION_LABEL[data.verificationStatus]} 상태라 파일을 바꿀 수 없어요.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>심사</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.verificationStatus === 'PENDING' ? (
            <p className="text-sm leading-relaxed text-muted-foreground">
              운영자가 확인하고 있어요. 결과가 나오면 알림으로 알려드릴게요.
            </p>
          ) : data.verificationStatus === 'VERIFIED' ? (
            <p className="text-sm leading-relaxed text-muted-foreground">
              확인이 끝났어요. 이제 이 사업자 아래에 시설을 만들고 검수에 올릴 수 있어요.
            </p>
          ) : (
            <p className="text-sm leading-relaxed text-muted-foreground">
              사업자등록증을 올린 뒤 심사를 요청하면 운영자가 확인해요.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!canSubmitVerification}
              leadingIcon={<FileCheck2 className="h-4 w-4" aria-hidden="true" />}
              onClick={() => setConfirmSubmit(true)}
            >
              심사 요청하기
            </Button>

            <Button
              variant="ghost"
              className="text-destructive"
              leadingIcon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
              onClick={() => setConfirmDelete(true)}
            >
              삭제
            </Button>
          </div>

          {!canSubmitVerification && editable ? (
            <p className="text-sm text-muted-foreground">
              사업자등록증을 먼저 올려야 심사를 요청할 수 있어요.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={confirmSubmit} onOpenChange={setConfirmSubmit}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>심사를 요청할까요?</DialogTitle>
            <DialogDescription>
              요청하면 결과가 나올 때까지 등록번호·업종·대표자명을 바꿀 수 없어요.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmSubmit(false)}>
              취소
            </Button>
            <Button loading={submitVerification.isPending} onClick={() => submitVerification.mutate()}>
              심사 요청
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>사업자를 삭제할까요?</DialogTitle>
            <DialogDescription>
              연결된 시설이 남아 있거나 심사 중이면 삭제되지 않아요. 되돌릴 수 없어요.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              취소
            </Button>
            <Button variant="destructive" loading={remove.isPending} onClick={() => remove.mutate()}>
              삭제하기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
