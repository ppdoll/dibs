'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { BUSINESS_TYPE_LABEL } from '../_lib/labels';
import { ErrorBanner, InfoNote } from './partner-page';
import { toFieldErrors, toPartnerMessage } from '../_lib/errors';
import type { BusinessType, CreateBusinessBody } from '../_lib/types';

/**
 * 사업자 등록·수정 폼.
 *
 * 등록번호·업종·대표자명은 **심사 대상 정보**라 심사 중(PENDING)·확인 완료(VERIFIED)
 * 상태에서는 서버가 변경을 거절한다. 폼에서 미리 잠그는 이유는 저장 버튼을 누른 뒤에
 * 거절당하는 것보다 처음부터 못 만지는 편이 덜 답답하기 때문이다. 진짜 방어는 서버다.
 */

const BUSINESS_TYPE_OPTIONS = (Object.keys(BUSINESS_TYPE_LABEL) as BusinessType[]).map((value) => ({
  value,
  label: BUSINESS_TYPE_LABEL[value],
}));

export interface BusinessFormValues extends CreateBusinessBody {}

export function BusinessForm({
  initial,
  submitLabel,
  submitting,
  error,
  lockReviewedFields = false,
  onSubmit,
  onCancel,
}: {
  initial?: Partial<BusinessFormValues>;
  submitLabel: string;
  submitting: boolean;
  error: unknown;
  /** 심사 중·확인 완료라 등록번호·업종·대표자명을 못 고치는 상태인가 */
  lockReviewedFields?: boolean;
  onSubmit: (values: BusinessFormValues) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [legalName, setLegalName] = useState(initial?.legalName ?? '');
  const [brn, setBrn] = useState(initial?.businessRegistrationNumber ?? '');
  const [businessType, setBusinessType] = useState<BusinessType>(
    initial?.businessType ?? 'INDIVIDUAL',
  );
  const [representativeName, setRepresentativeName] = useState(initial?.representativeName ?? '');
  const [contactEmail, setContactEmail] = useState(initial?.contactEmail ?? '');
  const [contactPhone, setContactPhone] = useState(initial?.contactPhone ?? '');
  const [postalCode, setPostalCode] = useState(initial?.postalCode ?? '');
  const [roadAddress, setRoadAddress] = useState(initial?.roadAddress ?? '');
  const [detailAddress, setDetailAddress] = useState(initial?.detailAddress ?? '');

  const fieldErrors = toFieldErrors(error);

  const required =
    name.trim() &&
    legalName.trim() &&
    brn.trim() &&
    representativeName.trim() &&
    contactEmail.trim() &&
    contactPhone.trim();

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    onSubmit({
      name: name.trim(),
      legalName: legalName.trim(),
      businessRegistrationNumber: brn.trim(),
      businessType,
      representativeName: representativeName.trim(),
      contactEmail: contactEmail.trim(),
      contactPhone: contactPhone.trim(),
      // 빈 문자열을 보내면 서버가 "우편번호는 5자리" 로 막는다. 아예 키를 빼는 게 PATCH 의 의미다.
      ...(postalCode.trim() ? { postalCode: postalCode.trim() } : {}),
      ...(roadAddress.trim() ? { roadAddress: roadAddress.trim() } : {}),
      ...(detailAddress.trim() ? { detailAddress: detailAddress.trim() } : {}),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <ErrorBanner message={error ? toPartnerMessage(error) : null} />

      {lockReviewedFields ? (
        <InfoNote title="일부 항목이 잠겨 있어요">
          등록번호·업종·대표자명은 심사 대상 정보라 심사 중이거나 확인이 끝난 뒤에는 바꿀 수
          없어요. 수정이 필요하면 고객센터로 문의해 주세요.
        </InfoNote>
      ) : null}

      <Field label="상호 (브랜드명)" htmlFor="name" required hint="이용자에게 보이는 이름이에요.">
        <Input
          id="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={60}
          placeholder="딥스 다이닝"
          error={fieldErrors.name}
        />
      </Field>

      <Field
        label="사업자등록증상 상호"
        htmlFor="legalName"
        required
        hint="등록증에 적힌 그대로 적어 주세요."
      >
        <Input
          id="legalName"
          value={legalName}
          onChange={(event) => setLegalName(event.target.value)}
          maxLength={60}
          placeholder="주식회사 딥스"
          error={fieldErrors.legalName}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="사업자등록번호"
          htmlFor="brn"
          required
          hint="하이픈은 있어도 없어도 괜찮아요."
        >
          <Input
            id="brn"
            value={brn}
            onChange={(event) => setBrn(event.target.value)}
            inputMode="numeric"
            placeholder="123-45-67890"
            disabled={lockReviewedFields}
            error={fieldErrors.businessRegistrationNumber}
          />
        </Field>

        <Field label="업종" htmlFor="businessType" required>
          <Select
            id="businessType"
            value={businessType}
            onChange={(event) => setBusinessType(event.target.value as BusinessType)}
            options={BUSINESS_TYPE_OPTIONS}
            disabled={lockReviewedFields}
            error={fieldErrors.businessType}
          />
        </Field>
      </div>

      <Field label="대표자명" htmlFor="representativeName" required>
        <Input
          id="representativeName"
          value={representativeName}
          onChange={(event) => setRepresentativeName(event.target.value)}
          maxLength={30}
          disabled={lockReviewedFields}
          error={fieldErrors.representativeName}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="담당자 이메일" htmlFor="contactEmail" required>
          <Input
            id="contactEmail"
            type="email"
            inputMode="email"
            value={contactEmail}
            onChange={(event) => setContactEmail(event.target.value)}
            maxLength={255}
            placeholder="owner@example.com"
            error={fieldErrors.contactEmail}
          />
        </Field>

        <Field label="담당자 연락처" htmlFor="contactPhone" required>
          <Input
            id="contactPhone"
            type="tel"
            inputMode="tel"
            value={contactPhone}
            onChange={(event) => setContactPhone(event.target.value)}
            placeholder="02-1234-5678"
            error={fieldErrors.contactPhone}
          />
        </Field>
      </div>

      <Field label="우편번호" htmlFor="postalCode" hint="선택 사항이에요. 5자리 숫자만 받아요.">
        <Input
          id="postalCode"
          value={postalCode}
          onChange={(event) => setPostalCode(event.target.value)}
          inputMode="numeric"
          maxLength={5}
          placeholder="06236"
          error={fieldErrors.postalCode}
        />
      </Field>

      <Field label="사업장 주소" htmlFor="roadAddress">
        <Input
          id="roadAddress"
          value={roadAddress}
          onChange={(event) => setRoadAddress(event.target.value)}
          maxLength={255}
          placeholder="서울 강남구 테헤란로 1"
          error={fieldErrors.roadAddress}
        />
      </Field>

      <Field label="상세 주소" htmlFor="detailAddress">
        <Input
          id="detailAddress"
          value={detailAddress}
          onChange={(event) => setDetailAddress(event.target.value)}
          maxLength={255}
          placeholder="3층"
          error={fieldErrors.detailAddress}
        />
      </Field>

      <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            취소
          </Button>
        ) : null}
        <Button type="submit" loading={submitting} disabled={!required}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
