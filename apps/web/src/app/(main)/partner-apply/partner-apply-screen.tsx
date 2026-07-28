'use client';

import { BadgeCheck, Clock3, Store } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { AppShell, TopBar } from '@/components/layout';
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Skeleton,
  useToast,
} from '@/components/ui';
import { isApiError, toUserMessage } from '@/lib/api-client';
import { PARTNER_APPROVAL_LABEL, labelOf } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useAuth, useRequireAuth } from '@/providers/auth-provider';
import { buttonVariants } from '@/components/ui/button';

import { useSubmitPartnerApplication } from '../_lib/queries';

/**
 * 파트너 전환 신청. (D-09)
 *
 * 신청서를 내면 끝이 아니라 **운영자 승인 후에야** 예약을 만들 수 있다.
 * 그 사실을 제출 전에 분명히 적어 둔다 — 제출 직후 아무것도 안 되는 걸 보고
 * 고장이라고 생각하는 게 이 흐름에서 가장 흔한 오해다.
 */

/** 동의한 파트너 약관의 버전. 약관 문서를 고치면 이 값도 올린다. */
const PARTNER_TERMS_VERSION = 'v1';

export function PartnerApplyScreen() {
  const { isReady } = useRequireAuth();
  const auth = useAuth();
  const toast = useToast();
  const submit = useSubmitPartnerApplication();

  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [agreed, setAgreed] = useState(false);

  if (!isReady) {
    return (
      <AppShell header={<TopBar showBack backHref="/my" title="파트너 전환 신청" />}>
        <div className="space-y-4 py-6">
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-56 w-full rounded-lg" />
        </div>
      </AppShell>
    );
  }

  // 이미 파트너면 신청서를 또 받지 않는다. 지금 상태와 다음 할 일만 보여준다.
  if (auth.isPartner) {
    return (
      <AppShell header={<TopBar showBack backHref="/my" title="파트너" />}>
        <div className="py-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            {auth.isApprovedPartner ? (
              <BadgeCheck className="h-7 w-7 text-emerald-500" aria-hidden="true" />
            ) : (
              <Clock3 className="h-7 w-7 text-amber-500" aria-hidden="true" />
            )}
          </div>

          <p className="mt-4 text-base font-bold">
            {auth.isApprovedPartner ? '파트너 승인이 완료되었어요' : '파트너 심사가 진행 중이에요'}
          </p>

          <div className="mt-2 flex justify-center">
            <Badge variant={auth.isApprovedPartner ? 'success' : 'warning'}>
              {labelOf(PARTNER_APPROVAL_LABEL, auth.me?.partnerApprovalStatus, '심사 중')}
            </Badge>
          </div>

          <p className="mx-auto mt-3 max-w-xs text-sm leading-relaxed text-muted-foreground">
            {auth.isApprovedPartner
              ? '이제 시설을 등록하고 예약을 열 수 있어요.'
              : '결과는 알림과 이메일로 알려드려요. 보완 요청이 오면 파트너 화면에서 이어서 작성할 수 있어요.'}
          </p>

          <Link
            href={auth.isApprovedPartner ? '/partner' : '/my'}
            className={cn(buttonVariants({ size: 'lg' }), 'mt-5')}
          >
            {auth.isApprovedPartner ? '파트너 콘솔로 이동' : '내정보로 돌아가기'}
          </Link>
        </div>
      </AppShell>
    );
  }

  const nameError = isApiError(submit.error) ? submit.error.fieldMessage('contactName') : undefined;
  const emailError = isApiError(submit.error)
    ? submit.error.fieldMessage('contactEmail')
    : undefined;
  const phoneError = isApiError(submit.error)
    ? submit.error.fieldMessage('contactPhone')
    : undefined;

  const canSubmit =
    contactName.trim().length > 0 &&
    contactEmail.trim().length > 0 &&
    agreed &&
    !submit.isPending;

  const onSubmit = () => {
    submit.mutate(
      {
        contactName: contactName.trim(),
        contactEmail: contactEmail.trim(),
        ...(contactPhone.trim() ? { contactPhone: contactPhone.trim() } : {}),
        partnerTermsVersion: PARTNER_TERMS_VERSION,
      },
      {
        onSuccess: () => {
          toast.success('파트너 신청서를 접수했어요', '심사 결과는 알림으로 알려드릴게요.');
        },
        onError: (error) => {
          toast.error('신청서를 보내지 못했어요', toUserMessage(error));
        },
      },
    );
  };

  const banner = isApiError(submit.error) && submit.error.issues.length === 0
    ? submit.error.message
    : null;

  return (
    <AppShell header={<TopBar showBack backHref="/my" title="파트너 전환 신청" />}>
      <section className="py-5">
        <div className="flex items-start gap-3 rounded-lg border bg-card p-4">
          <Store className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-bold">직접 예약을 열고 싶으신가요?</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              파트너가 되면 시설을 등록하고 선착순 즉시확정 · 금액 제안 예약을 만들 수 있어요.
              담당자 정보를 남겨 주시면 운영자가 확인 후 승인해 드려요.
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-4 pb-4">
        <Field label="담당자 이름" htmlFor="contact-name" required>
          <Input
            id="contact-name"
            value={contactName}
            maxLength={40}
            autoComplete="name"
            placeholder="예: 김딥스"
            onChange={(e) => setContactName(e.target.value)}
            error={nameError}
          />
        </Field>

        <Field
          label="연락받을 이메일"
          htmlFor="contact-email"
          required
          hint="심사 결과와 보완 요청을 이 주소로 보내드려요."
        >
          <Input
            id="contact-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={contactEmail}
            maxLength={120}
            placeholder="partner@example.com"
            onChange={(e) => setContactEmail(e.target.value)}
            error={emailError}
          />
        </Field>

        <Field label="연락처" htmlFor="contact-phone" hint="선택 사항이에요.">
          <Input
            id="contact-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={contactPhone}
            maxLength={20}
            placeholder="010-0000-0000"
            onChange={(e) => setContactPhone(e.target.value)}
            error={phoneError}
          />
        </Field>
      </section>

      <Card className="p-4">
        <p className="text-sm font-bold">신청 전에 확인해 주세요</p>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-sm leading-relaxed text-muted-foreground">
          <li>운영자 승인 전에는 시설·예약을 만들 수 없어요.</li>
          <li>승인 후 사업자 정보와 시설 검수를 한 번 더 거쳐요.</li>
          <li>보완 요청을 받으면 신청서를 이어서 고칠 수 있어요.</li>
        </ul>
      </Card>

      {banner ? (
        <p className="mt-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {banner}
        </p>
      ) : null}

      <label className="my-5 flex cursor-pointer items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-[hsl(var(--primary))]"
        />
        <span>
          파트너 이용약관과 정산·수수료 정책에 동의해요.{' '}
          <span className="text-primary">(필수)</span>
        </span>
      </label>

      <div className="pb-8">
        <Button full size="xl" loading={submit.isPending} disabled={!canSubmit} onClick={onSubmit}>
          신청서 보내기
        </Button>
      </div>
    </AppShell>
  );
}
