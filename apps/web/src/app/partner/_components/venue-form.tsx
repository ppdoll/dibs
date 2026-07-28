'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Chip, ChipGroup } from '@/components/ui/tabs';
import { Field, FieldHint } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { qk } from '@/lib/query-keys';
import { listCategories, listRegions } from '../_lib/api';
import { WEEKDAY_LABEL } from '../_lib/labels';
import { ErrorBanner, InfoNote } from './partner-page';
import { toFieldErrors, toPartnerMessage } from '../_lib/errors';
import type { CreateVenueBody, DayHours, PartnerVenueDetail } from '../_lib/types';

/**
 * 시설 등록·수정 폼.
 *
 * 지역은 두 단계로 고른다(시/도 → 시/군/구). 서버가 받는 `regionCode` 는 **SIGUNGU 레벨의
 * 법정동코드 10자리**뿐이라, 한 번에 고르게 하면 목록이 수백 개가 되고 잘못 고를 여지도 커진다.
 *
 * 영업시간은 요일별 벽시계 문자열이다(UTC 환산 금지). "매주 화요일 11시 오픈" 은 시각이 아니라
 * 규칙이라서, 환산해 저장하면 규칙이 아니라 그 시점의 계산 결과가 굳어버린다.
 */

const WEEKDAYS: DayHours['day'][] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

const DEFAULT_HOURS: DayHours[] = WEEKDAYS.map((day) => ({
  day,
  closed: false,
  open: '11:00',
  close: '22:00',
}));

export interface VenueFormValues extends CreateVenueBody {}

export function VenueForm({
  mode,
  initial,
  businessOptions,
  submitLabel,
  submitting,
  error,
  onSubmit,
  onCancel,
}: {
  mode: 'create' | 'edit';
  initial?: Partial<PartnerVenueDetail> & { businessId?: string };
  /** 확인이 끝난 사업자만 넘긴다. 미확인 사업자로 만들면 검수에 올릴 수 없다. */
  businessOptions: { value: string; label: string; disabled?: boolean }[];
  submitLabel: string;
  submitting: boolean;
  error: unknown;
  onSubmit: (values: VenueFormValues) => void;
  onCancel?: () => void;
}) {
  const [businessId, setBusinessId] = useState(
    initial?.businessId ?? businessOptions.find((option) => !option.disabled)?.value ?? '',
  );
  const [name, setName] = useState(initial?.name ?? '');
  const [summary, setSummary] = useState(initial?.summary ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [primaryCategoryId, setPrimaryCategoryId] = useState(initial?.primaryCategoryId ?? '');
  const [secondaryCategoryIds, setSecondaryCategoryIds] = useState<string[]>(
    initial?.secondaryCategoryIds ?? [],
  );
  const [sidoCode, setSidoCode] = useState('');
  const [regionCode, setRegionCode] = useState(initial?.regionCode ?? '');
  const [postalCode, setPostalCode] = useState(initial?.postalCode ?? '');
  const [roadAddress, setRoadAddress] = useState(initial?.roadAddress ?? '');
  const [detailAddress, setDetailAddress] = useState(initial?.detailAddress ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [websiteUrl, setWebsiteUrl] = useState(initial?.websiteUrl ?? '');
  const [instagramHandle, setInstagramHandle] = useState(initial?.instagramHandle ?? '');
  const [seatCount, setSeatCount] = useState(
    initial?.seatCount === null || initial?.seatCount === undefined ? '' : String(initial.seatCount),
  );
  const [reservationNotice, setReservationNotice] = useState(initial?.reservationNotice ?? '');
  const [hours, setHours] = useState<DayHours[]>(
    initial?.businessHours && initial.businessHours.length > 0 ? initial.businessHours : DEFAULT_HOURS,
  );

  const categories = useQuery({
    queryKey: qk.catalog.categories,
    queryFn: () => listCategories(),
    staleTime: 10 * 60_000,
  });

  const sidoList = useQuery({
    queryKey: [...qk.catalog.regions, 'SIDO'],
    queryFn: () => listRegions({ level: 'SIDO' }),
    staleTime: 10 * 60_000,
  });

  const sigunguList = useQuery({
    queryKey: [...qk.catalog.regions, 'SIGUNGU', sidoCode],
    queryFn: () => listRegions({ level: 'SIGUNGU', parentCode: sidoCode }),
    enabled: sidoCode.length > 0,
    staleTime: 10 * 60_000,
  });

  // 2단계 트리를 평평하게 편다. 시설 카테고리는 잎(자식)을 고르는 게 자연스럽고,
  // 자식이 없는 대분류는 그 자체가 잎이다.
  const categoryOptions = useMemo(() => {
    const flat: { value: string; label: string }[] = [];
    for (const parent of categories.data ?? []) {
      if (parent.children.length === 0) {
        flat.push({ value: parent.id, label: parent.nameKo });
        continue;
      }
      for (const child of parent.children) {
        flat.push({ value: child.id, label: `${parent.nameKo} · ${child.nameKo}` });
      }
    }
    return flat;
  }, [categories.data]);

  const fieldErrors = toFieldErrors(error);

  const toggleSecondary = (id: string) => {
    setSecondaryCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((value) => value !== id) : prev.length >= 5 ? prev : [...prev, id],
    );
  };

  const updateDay = (day: DayHours['day'], patch: Partial<DayHours>) => {
    setHours((prev) => prev.map((row) => (row.day === day ? { ...row, ...patch } : row)));
  };

  const canSubmit =
    (mode === 'edit' || businessId.length > 0) &&
    name.trim().length > 0 &&
    primaryCategoryId.length > 0 &&
    regionCode.length > 0 &&
    postalCode.trim().length === 5 &&
    roadAddress.trim().length > 0 &&
    phone.trim().length > 0;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    const parsedSeats = Number(seatCount.replace(/[^\d]/g, ''));

    onSubmit({
      businessId,
      name: name.trim(),
      primaryCategoryId,
      secondaryCategoryIds: secondaryCategoryIds.filter((id) => id !== primaryCategoryId),
      regionCode,
      postalCode: postalCode.trim(),
      roadAddress: roadAddress.trim(),
      phone: phone.trim(),
      ...(summary.trim() ? { summary: summary.trim() } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(detailAddress.trim() ? { detailAddress: detailAddress.trim() } : {}),
      ...(websiteUrl.trim() ? { websiteUrl: websiteUrl.trim() } : {}),
      ...(instagramHandle.trim() ? { instagramHandle: instagramHandle.trim() } : {}),
      ...(Number.isFinite(parsedSeats) && parsedSeats > 0 ? { seatCount: parsedSeats } : {}),
      ...(reservationNotice.trim() ? { reservationNotice: reservationNotice.trim() } : {}),
      businessHours: hours,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <ErrorBanner message={error ? toPartnerMessage(error) : null} />

      <section className="space-y-5">
        <h2 className="text-base font-bold">기본 정보</h2>

        {mode === 'create' ? (
          <Field
            label="사업자"
            htmlFor="businessId"
            required
            hint="확인이 끝난 사업자 아래에서만 시설을 검수에 올릴 수 있어요."
          >
            <Select
              id="businessId"
              value={businessId}
              onChange={(event) => setBusinessId(event.target.value)}
              options={businessOptions}
              placeholder="사업자를 선택해 주세요"
              error={fieldErrors.businessId}
            />
          </Field>
        ) : null}

        <Field label="시설 이름" htmlFor="name" required>
          <Input
            id="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={60}
            placeholder="딥스 다이닝 강남점"
            error={fieldErrors.name}
          />
        </Field>

        <Field label="한 줄 소개" htmlFor="summary" hint="목록 카드에 보이는 짧은 설명이에요.">
          <Input
            id="summary"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            maxLength={60}
            placeholder="제철 재료로 만드는 코스 요리"
            error={fieldErrors.summary}
          />
        </Field>

        <Field label="소개글" htmlFor="description">
          <Textarea
            id="description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={5000}
            showCount
            rows={6}
            placeholder="시설의 분위기, 대표 메뉴, 이용 안내를 적어 주세요."
            error={fieldErrors.description}
          />
        </Field>
      </section>

      <section className="space-y-5">
        <h2 className="text-base font-bold">업종</h2>

        <Field label="대표 업종" htmlFor="primaryCategoryId" required>
          <Select
            id="primaryCategoryId"
            value={primaryCategoryId}
            onChange={(event) => setPrimaryCategoryId(event.target.value)}
            options={categoryOptions}
            placeholder={categories.isLoading ? '불러오는 중…' : '업종을 선택해 주세요'}
            disabled={categories.isLoading}
            error={fieldErrors.primaryCategoryId}
          />
        </Field>

        <div>
          <p className="mb-1.5 text-sm font-medium">추가 업종</p>
          <FieldHint>검색 필터에 함께 걸려요. 최대 5개까지 고를 수 있어요.</FieldHint>
          <ChipGroup className="mt-2 flex-wrap">
            {categoryOptions
              .filter((option) => option.value !== primaryCategoryId)
              .map((option) => (
                <Chip
                  key={option.value}
                  selected={secondaryCategoryIds.includes(option.value)}
                  onClick={() => toggleSecondary(option.value)}
                >
                  {option.label}
                </Chip>
              ))}
          </ChipGroup>
        </div>
      </section>

      <section className="space-y-5">
        <h2 className="text-base font-bold">주소</h2>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="시 · 도" htmlFor="sido" required={mode === 'create'}>
            <Select
              id="sido"
              value={sidoCode}
              onChange={(event) => {
                setSidoCode(event.target.value);
                setRegionCode('');
              }}
              options={(sidoList.data ?? []).map((region) => ({
                value: region.code,
                label: region.displayName,
              }))}
              placeholder={sidoList.isLoading ? '불러오는 중…' : '선택해 주세요'}
              disabled={sidoList.isLoading}
            />
          </Field>

          <Field
            label="시 · 군 · 구"
            htmlFor="regionCode"
            required
            hint={
              mode === 'edit' && regionCode && !sidoCode
                ? '지역을 바꾸려면 시·도부터 다시 골라 주세요.'
                : undefined
            }
          >
            <Select
              id="regionCode"
              value={regionCode}
              onChange={(event) => setRegionCode(event.target.value)}
              options={(sigunguList.data ?? []).map((region) => ({
                value: region.code,
                label: region.sigungu ?? region.displayName,
              }))}
              placeholder={sidoCode ? (sigunguList.isLoading ? '불러오는 중…' : '선택해 주세요') : '시·도를 먼저 골라 주세요'}
              disabled={!sidoCode || sigunguList.isLoading}
              error={fieldErrors.regionCode}
            />
          </Field>
        </div>

        <div className="grid gap-5 sm:grid-cols-[160px_1fr]">
          <Field label="우편번호" htmlFor="postalCode" required>
            <Input
              id="postalCode"
              value={postalCode}
              onChange={(event) => setPostalCode(event.target.value.replace(/[^\d]/g, ''))}
              inputMode="numeric"
              maxLength={5}
              placeholder="06236"
              error={fieldErrors.postalCode}
            />
          </Field>

          <Field label="도로명 주소" htmlFor="roadAddress" required>
            <Input
              id="roadAddress"
              value={roadAddress}
              onChange={(event) => setRoadAddress(event.target.value)}
              maxLength={255}
              placeholder="서울 강남구 테헤란로 1"
              error={fieldErrors.roadAddress}
            />
          </Field>
        </div>

        <Field label="상세 주소" htmlFor="detailAddress">
          <Input
            id="detailAddress"
            value={detailAddress}
            onChange={(event) => setDetailAddress(event.target.value)}
            maxLength={255}
            placeholder="지하 1층"
            error={fieldErrors.detailAddress}
          />
        </Field>
      </section>

      <section className="space-y-5">
        <h2 className="text-base font-bold">연락처 · 규모</h2>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="전화번호" htmlFor="phone" required>
            <Input
              id="phone"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="02-1234-5678"
              error={fieldErrors.phone}
            />
          </Field>

          <Field label="좌석 수" htmlFor="seatCount">
            <Input
              id="seatCount"
              value={seatCount}
              onChange={(event) => setSeatCount(event.target.value.replace(/[^\d]/g, ''))}
              inputMode="numeric"
              trailing="석"
              placeholder="24"
              error={fieldErrors.seatCount}
            />
          </Field>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="웹사이트" htmlFor="websiteUrl" hint="https:// 로 시작해야 해요.">
            <Input
              id="websiteUrl"
              type="url"
              value={websiteUrl}
              onChange={(event) => setWebsiteUrl(event.target.value)}
              maxLength={500}
              placeholder="https://example.com"
              error={fieldErrors.websiteUrl}
            />
          </Field>

          <Field label="인스타그램" htmlFor="instagramHandle" hint="@ 없이 아이디만 적어 주세요.">
            <Input
              id="instagramHandle"
              value={instagramHandle}
              onChange={(event) => setInstagramHandle(event.target.value)}
              leading="@"
              maxLength={30}
              placeholder="dibs.gangnam"
              error={fieldErrors.instagramHandle}
            />
          </Field>
        </div>

        <Field
          label="예약 안내"
          htmlFor="reservationNotice"
          hint="주차, 노쇼 정책처럼 예약 전에 알아야 할 내용을 적어 주세요."
        >
          <Textarea
            id="reservationNotice"
            value={reservationNotice}
            onChange={(event) => setReservationNotice(event.target.value)}
            maxLength={2000}
            showCount
            rows={4}
            error={fieldErrors.reservationNotice}
          />
        </Field>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-bold">영업시간</h2>
        <InfoNote>
          매주 반복되는 규칙이라 한국 시간 기준 벽시계로 적어요. 자정을 넘겨 영업한다면
          24:00 을 넘겨 적지 말고 다음 요일로 나눠 적어 주세요.
        </InfoNote>

        <ul className="divide-y rounded-lg border">
          {hours.map((row) => (
            <li key={row.day} className="flex flex-wrap items-center gap-3 p-3">
              <span className="w-8 shrink-0 text-sm font-semibold">{WEEKDAY_LABEL[row.day]}</span>

              <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={row.closed}
                  onChange={(event) => updateDay(row.day, { closed: event.target.checked })}
                  className="h-4 w-4 accent-[hsl(var(--primary))]"
                />
                휴무
              </label>

              {!row.closed ? (
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={row.open ?? ''}
                    onChange={(event) => updateDay(row.day, { open: event.target.value })}
                    aria-label={`${WEEKDAY_LABEL[row.day]}요일 영업 시작`}
                    className="h-10 rounded-lg border border-input bg-background px-2 text-sm"
                  />
                  <span className="text-muted-foreground">~</span>
                  <input
                    type="time"
                    value={row.close ?? ''}
                    onChange={(event) => updateDay(row.day, { close: event.target.value })}
                    aria-label={`${WEEKDAY_LABEL[row.day]}요일 영업 종료`}
                    className="h-10 rounded-lg border border-input bg-background px-2 text-sm"
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <div className="flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:justify-end">
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            취소
          </Button>
        ) : null}
        <Button type="submit" size="lg" loading={submitting} disabled={!canSubmit}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
