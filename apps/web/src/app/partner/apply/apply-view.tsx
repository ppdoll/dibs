'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { SkeletonList } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { qk } from '@/lib/query-keys';
import { useAuth } from '@/providers/auth-provider';
import { submitPartnerApplication } from '../_lib/api';
import { ErrorBanner, InfoNote, PartnerPageHeader } from '../_components/partner-page';
import { toFieldErrors, toPartnerMessage } from '../_lib/errors';

/**
 * 동의한 파트너 약관 버전.
 *
 * 서버는 이 문자열을 그대로 저장만 한다(검증하지 않는다). 약관이 개정되면 이 값을 올려야
 * "누가 어느 판본에 동의했는가" 가 남는다. 지금은 상수지만, 운영자 설정에서 내려주는
 * 값으로 바꾸는 게 맞다 — followUps 참고.
 */
const PARTNER_TERMS_VERSION = '2026-07-01';

/**
 * 파트너 신청서. (D-09)
 *
 * PartnerShell 로 감싸지 않는다 — 이 화면은 "아직 파트너가 아닌 사람" 이 오는 곳이라
 * 파트너 게이트가 입구를 막으면 신청 자체를 할 수 없다.
 */
export function ApplyView() {
  const { isLoading, isAuthenticated, isPartner, isApprovedPartner, me, login, refresh } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { success } = useToast();

  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [agreed, setAgreed] = useState(false);

  const submit = useMutation({
    mutationFn: () =>
      submitPartnerApplication({
        contactName: contactName.trim(),
        contactEmail: contactEmail.trim(),
        ...(contactPhone.trim() ? { contactPhone: contactPhone.trim() } : {}),
        partnerTermsVersion: PARTNER_TERMS_VERSION,
      }),
    onSuccess: async () => {
      // 신청서를 내면 PARTNER 역할이 붙는다. me 를 다시 읽지 않으면 콘솔이 계속
      // "파트너 계정이 아니에요" 를 보여준다.
      await refresh();
      await queryClient.invalidateQueries({ queryKey: qk.partner.all });
      success('신청서를 제출했어요', '운영자 확인이 끝나면 알림으로 알려드릴게요.');
      router.push('/partner/profile');
    },
  });

  if (isLoading) return <SkeletonList count={3} className="mx-auto max-w-xl p-4 md:p-6" />;

  if (!isAuthenticated) {
    return (
      <div className="mx-auto max-w-xl p-4 md:p-6">
        <EmptyState
          title="로그인이 필요해요"
          description="파트너 신청은 로그인 후 진행할 수 있어요."
          action={<Button onClick={() => login({ intent: 'PARTNER', redirect: '/partner/apply' })}>구글로 로그인</Button>}
        />
      </div>
    );
  }

  if (isApprovedPartner) {
    return (
      <div className="mx-auto max-w-xl p-4 md:p-6">
        <EmptyState
          title="이미 승인된 파트너예요"
          description="바로 이벤트를 만들 수 있어요."
          action={<Button onClick={() => router.push('/partner')}>파트너 센터로 가기</Button>}
        />
      </div>
    );
  }

  const pending = isPartner && me?.partnerApprovalStatus === 'PENDING';
  const fieldErrors = toFieldErrors(submit.error);
  const canSubmit = contactName.trim().length > 0 && contactEmail.trim().length > 0 && agreed;

  return (
    <div className="mx-auto max-w-xl p-4 md:p-6">
      <PartnerPageHeader
        title="파트너 신청"
        description="시설을 등록하고 예약 이벤트를 열려면 먼저 운영자 확인이 필요해요."
      />

      {pending ? (
        <InfoNote className="mb-4" title="이미 심사 중이에요">
          결과를 기다리는 중이에요. 내용을 고쳐 다시 내면 심사가 처음부터 다시 시작돼요.
        </InfoNote>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>담당자 정보</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ErrorBanner message={submit.isError ? toPartnerMessage(submit.error) : null} />

          <Field label="담당자 이름" htmlFor="contactName" required>
            <Input
              id="contactName"
              value={contactName}
              onChange={(event) => setContactName(event.target.value)}
              placeholder="예약 문의를 받을 분의 이름"
              maxLength={50}
              error={fieldErrors.contactName}
            />
          </Field>

          <Field
            label="담당자 이메일"
            htmlFor="contactEmail"
            required
            hint="심사 결과와 운영 안내가 이 주소로 가요."
          >
            <Input
              id="contactEmail"
              type="email"
              inputMode="email"
              value={contactEmail}
              onChange={(event) => setContactEmail(event.target.value)}
              placeholder="partner@example.com"
              maxLength={255}
              error={fieldErrors.contactEmail}
            />
          </Field>

          <Field label="연락처" htmlFor="contactPhone" hint="선택 사항이에요.">
            <Input
              id="contactPhone"
              type="tel"
              inputMode="tel"
              value={contactPhone}
              onChange={(event) => setContactPhone(event.target.value)}
              placeholder="02-1234-5678"
              maxLength={20}
              error={fieldErrors.contactPhone}
            />
          </Field>

          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border p-3.5">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(event) => setAgreed(event.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-[hsl(var(--primary))]"
            />
            <span className="text-sm leading-relaxed">
              파트너 이용약관에 동의해요.
              <span className="ml-1 text-muted-foreground">(v{PARTNER_TERMS_VERSION})</span>
            </span>
          </label>

          <InfoNote>
            제출하면 운영자 심사가 시작돼요. 승인 전에는 이벤트를 만들 수 없지만, 사업자·시설
            정보를 미리 준비해 둘 수는 있어요.
          </InfoNote>

          <Button
            full
            size="lg"
            loading={submit.isPending}
            disabled={!canSubmit}
            onClick={() => submit.mutate()}
          >
            신청서 제출하기
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
