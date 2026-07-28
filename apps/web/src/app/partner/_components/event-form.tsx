'use client';

import {
  AMOUNT_MAX,
  DEFAULT_DEPOSIT_WINDOW_MINUTES,
  DEFAULT_SOFT_CLOSE_MINUTES,
  EventMode,
  isFixedAmount,
  requiredDeposit,
  validateAmountRule,
  validateDepositConfig,
  validatePeriod,
  validateServiceDate,
  validateSoftCloseConfig,
  type ValidationResult,
} from '@dibs/shared';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Field, FieldHint } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { EVENT_MODE_HINT, EVENT_MODE_LABEL, formatWon, parseWonInput } from '@/lib/format';
import { ErrorBanner, InfoNote } from './partner-page';
import { isoToKstLocal, kstLocalFromNow, kstLocalToIso } from '../_lib/datetime';
import { toFieldErrors, toPartnerMessage } from '../_lib/errors';
import type { CreateEventBody, EventModeValue, PartnerEventDetail } from '../_lib/types';

/**
 * 이벤트 생성·수정 폼. 콘솔에서 가장 복잡한 화면이다.
 *
 * 검증을 **서버와 같은 함수**(@dibs/shared)로 돌리는 게 핵심이다. 프론트에서 규칙을 다시
 * 쓰면 두 벌이 반드시 어긋나고, 그때 파트너는 "화면은 통과했는데 저장이 안 되는" 상태에
 * 갇힌다. 여기서는 같은 함수를 미리 돌려 **저장 버튼을 누르기 전에** 알려줄 뿐이고,
 * 최종 판정은 언제나 서버다.
 *
 * 모드(INSTANT/BID)는 만들 때만 고를 수 있다. 이미 달린 신청이 (eventId, mode) 복합 FK 로
 * 물려 있어서, 바꾸면 신청의 종류가 통째로 어긋난다 — 서버도 수정 대상에서 뺐다.
 */

export interface EventFormValues extends CreateEventBody {}

type DepositMode = 'FIXED' | 'PERCENT';

/** 검증 결과를 필드 → 문구 맵으로. 같은 필드에 여러 개면 첫 번째만 보여준다. */
function toIssueMap(...results: ValidationResult[]): Record<string, string> {
  const map: Record<string, string> = {};

  for (const result of results) {
    if (result.ok) continue;
    for (const issue of result.issues) {
      const key = issue.field ?? '_';
      if (!(key in map)) map[key] = issue.message;
    }
  }

  return map;
}

export function EventForm({
  mode: formMode,
  initial,
  venueOptions,
  categoryOptions,
  submitLabel,
  submitting,
  error,
  onSubmit,
  onCancel,
}: {
  mode: 'create' | 'edit';
  initial?: Partial<PartnerEventDetail>;
  venueOptions: { value: string; label: string; disabled?: boolean }[];
  categoryOptions: { value: string; label: string }[];
  submitLabel: string;
  submitting: boolean;
  error: unknown;
  onSubmit: (values: EventFormValues) => void;
  onCancel?: () => void;
}) {
  const isEdit = formMode === 'edit';

  const [venueId, setVenueId] = useState(
    initial?.venueId ?? venueOptions.find((option) => !option.disabled)?.value ?? '',
  );
  const [eventMode, setEventMode] = useState<EventModeValue>(initial?.mode ?? 'BID');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '');
  const [tagsText, setTagsText] = useState((initial?.tags ?? []).join(', '));
  const [capacity, setCapacity] = useState(String(initial?.capacity ?? 10));

  // 금액 — INSTANT 는 fixedAmount 하나, BID 는 min~max.
  const [fixedAmount, setFixedAmount] = useState(
    initial?.fixedAmount === null || initial?.fixedAmount === undefined
      ? ''
      : String(initial.fixedAmount),
  );
  const [minAmount, setMinAmount] = useState(
    initial?.minAmount === null || initial?.minAmount === undefined ? '' : String(initial.minAmount),
  );
  const [maxAmount, setMaxAmount] = useState(
    initial?.maxAmount === null || initial?.maxAmount === undefined ? '' : String(initial.maxAmount),
  );
  const [amountStep, setAmountStep] = useState(String(initial?.amountStep ?? 1000));

  const [applyStartAt, setApplyStartAt] = useState(
    initial?.applyStartAt ? isoToKstLocal(initial.applyStartAt) : kstLocalFromNow(1),
  );
  const [applyEndAt, setApplyEndAt] = useState(
    initial?.applyEndAt ? isoToKstLocal(initial.applyEndAt) : kstLocalFromNow(24 * 7),
  );
  const [serviceStartAt, setServiceStartAt] = useState(isoToKstLocal(initial?.serviceStartAt));
  const [serviceEndAt, setServiceEndAt] = useState(isoToKstLocal(initial?.serviceEndAt));

  // 예약금 (D-05)
  const [depositRequired, setDepositRequired] = useState(initial?.depositRequired ?? false);
  const [depositMode, setDepositMode] = useState<DepositMode>(
    (initial?.depositType as DepositMode | null | undefined) ?? 'PERCENT',
  );
  const [depositFixedAmount, setDepositFixedAmount] = useState(
    initial?.depositFixedAmount ? String(initial.depositFixedAmount) : '10000',
  );
  // 서버는 베이시스포인트(1000=10%)로 받지만 사람에게는 % 가 자연스럽다. 보낼 때 ×100 한다.
  const [depositPercent, setDepositPercent] = useState(
    initial?.depositPercentBp ? String(Math.round(initial.depositPercentBp / 100)) : '10',
  );
  const [depositRoundingUnit, setDepositRoundingUnit] = useState(
    String(initial?.depositRoundingUnit ?? 100),
  );
  const [depositWindowMinutes, setDepositWindowMinutes] = useState(
    String(initial?.depositWindowMinutes ?? DEFAULT_DEPOSIT_WINDOW_MINUTES),
  );
  const [depositRefundNote, setDepositRefundNote] = useState(initial?.depositRefundNote ?? '');

  // 소프트 클로즈 (D-08)
  const [softCloseEnabled, setSoftCloseEnabled] = useState(initial?.softCloseEnabled ?? false);
  const [softCloseWindowMinutes, setSoftCloseWindowMinutes] = useState(
    String(initial?.softCloseWindowMinutes ?? DEFAULT_SOFT_CLOSE_MINUTES),
  );
  const [softCloseExtendMinutes, setSoftCloseExtendMinutes] = useState(
    String(initial?.softCloseExtendMinutes ?? DEFAULT_SOFT_CLOSE_MINUTES),
  );
  const [softCloseHardEndAt, setSoftCloseHardEndAt] = useState(
    isoToKstLocal(initial?.softCloseHardEndAt),
  );
  const [softCloseMaxExtensions, setSoftCloseMaxExtensions] = useState(
    String(initial?.softCloseMaxExtensions ?? 6),
  );
  const [softCloseMaxExtensionsPerUser, setSoftCloseMaxExtensionsPerUser] = useState(
    String(initial?.softCloseMaxExtensionsPerUser ?? 2),
  );

  // 공개 정책 (D-07)
  const [showCompetitionRatio, setShowCompetitionRatio] = useState(
    initial?.showCompetitionRatio ?? true,
  );
  const [ratioMinApplicantsToShow, setRatioMinApplicantsToShow] = useState(
    String(initial?.ratioMinApplicantsToShow ?? 0),
  );

  const num = (raw: string) => parseWonInput(raw) ?? Number.NaN;

  const rule = useMemo(() => {
    if (eventMode === 'INSTANT') {
      const value = num(fixedAmount);
      return { min: value, max: value };
    }
    return { min: num(minAmount), max: num(maxAmount) };
  }, [eventMode, fixedAmount, minAmount, maxAmount]);

  const startIso = kstLocalToIso(applyStartAt);
  const endIso = kstLocalToIso(applyEndAt);
  const serviceIso = kstLocalToIso(serviceStartAt);
  const hardEndIso = kstLocalToIso(softCloseHardEndAt);

  const depositConfig = useMemo(
    () => ({
      required: depositRequired,
      type: depositMode,
      value: depositMode === 'PERCENT' ? num(depositPercent) : num(depositFixedAmount),
      windowMinutes: num(depositWindowMinutes),
    }),
    [depositRequired, depositMode, depositPercent, depositFixedAmount, depositWindowMinutes],
  );

  /**
   * 서버와 같은 규칙으로 미리 검사한다.
   *
   * 이미 시작된 이벤트를 고칠 때 "마감이 이미 지났습니다" 는 의미가 없다 —
   * 그건 새로 만들 때의 규칙이라 수정 모드에서는 걸러낸다.
   */
  const localIssues = useMemo(() => {
    const results: ValidationResult[] = [];

    results.push(
      validateAmountRule(rule, eventMode === 'INSTANT' ? EventMode.INSTANT : EventMode.BID),
    );

    if (startIso && endIso) {
      const period = { startAt: new Date(startIso), endAt: new Date(endIso) };
      const periodResult = validatePeriod(period, new Date());

      results.push(
        isEdit && !periodResult.ok
          ? {
              ok: false,
              issues: periodResult.issues.filter((issue) => issue.code !== 'PERIOD_ALREADY_ENDED'),
            }
          : periodResult,
      );

      results.push(validateServiceDate(serviceIso ? new Date(serviceIso) : null, period));

      if (softCloseEnabled) {
        results.push(
          validateSoftCloseConfig(
            {
              enabled: true,
              windowMinutes: num(softCloseWindowMinutes),
              extendMinutes: num(softCloseExtendMinutes),
              hardEndAt: hardEndIso ? new Date(hardEndIso) : null,
              maxExtensionsPerUser: num(softCloseMaxExtensionsPerUser),
            },
            period,
          ),
        );
      }
    }

    results.push(validateDepositConfig(depositConfig));

    // combine 이 만든 issues 중 issues 가 빈 배열이면 ok:true 와 같다. toIssueMap 이 걸러 준다.
    return toIssueMap(...results.filter((result) => result.ok || result.issues.length > 0));
  }, [
    rule,
    eventMode,
    startIso,
    endIso,
    serviceIso,
    hardEndIso,
    isEdit,
    softCloseEnabled,
    softCloseWindowMinutes,
    softCloseExtendMinutes,
    softCloseMaxExtensionsPerUser,
    depositConfig,
  ]);

  const serverErrors = toFieldErrors(error);
  const issue = (field: string): string | undefined => localIssues[field] ?? serverErrors[field];

  /** 예약금이 얼마가 되는지 미리 보여준다. 정률은 신청 금액에 따라 달라져서 오해가 잦다. */
  const depositPreview = useMemo(() => {
    if (!depositRequired) return null;
    const sample = eventMode === 'INSTANT' ? rule.min : rule.max;
    if (!Number.isFinite(sample) || sample <= 0) return null;
    if (!Number.isFinite(depositConfig.value) || depositConfig.value <= 0) return null;

    return {
      sample,
      amount: requiredDeposit(
        { ...depositConfig, type: depositMode },
        sample,
      ),
    };
  }, [depositRequired, depositConfig, depositMode, eventMode, rule]);

  const capacityNumber = num(capacity);

  const canSubmit =
    venueId.length > 0 &&
    title.trim().length > 0 &&
    description.trim().length > 0 &&
    Number.isFinite(capacityNumber) &&
    capacityNumber >= 1 &&
    startIso !== null &&
    endIso !== null &&
    Object.keys(localIssues).length === 0;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!startIso || !endIso) return;

    const tags = tagsText
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0)
      .slice(0, 10);

    onSubmit({
      venueId,
      mode: eventMode,
      title: title.trim(),
      description: description.trim(),
      capacity: capacityNumber,
      applyStartAt: startIso,
      applyEndAt: endIso,
      ...(categoryId ? { categoryId } : {}),
      ...(tags.length > 0 ? { tags } : {}),

      // 모드별로 한쪽만 싣는다. 두 벌이 함께 오면 서버가 요청 자체를 거절한다.
      ...(eventMode === 'INSTANT'
        ? { fixedAmount: rule.min }
        : { minAmount: rule.min, maxAmount: rule.max, amountStep: num(amountStep) || 1 }),

      ...(serviceIso ? { serviceStartAt: serviceIso } : {}),
      ...(kstLocalToIso(serviceEndAt) ? { serviceEndAt: kstLocalToIso(serviceEndAt) as string } : {}),

      depositRequired,
      ...(depositRequired
        ? {
            depositType: depositMode,
            ...(depositMode === 'FIXED'
              ? { depositFixedAmount: num(depositFixedAmount) }
              : { depositPercentBp: num(depositPercent) * 100 }),
            depositRoundingUnit: num(depositRoundingUnit) || 1,
            depositWindowMinutes: num(depositWindowMinutes),
            ...(depositRefundNote.trim() ? { depositRefundNote: depositRefundNote.trim() } : {}),
          }
        : {}),

      softCloseEnabled: eventMode === 'BID' ? softCloseEnabled : false,
      ...(eventMode === 'BID' && softCloseEnabled
        ? {
            softCloseWindowMinutes: num(softCloseWindowMinutes),
            softCloseExtendMinutes: num(softCloseExtendMinutes),
            softCloseMaxExtensions: num(softCloseMaxExtensions),
            softCloseMaxExtensionsPerUser: num(softCloseMaxExtensionsPerUser),
            ...(hardEndIso ? { softCloseHardEndAt: hardEndIso } : {}),
          }
        : {}),

      showCompetitionRatio,
      ratioMinApplicantsToShow: num(ratioMinApplicantsToShow) || 0,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-10">
      <ErrorBanner message={error ? toPartnerMessage(error) : null} />

      {/* ─── 진행 방식 ─────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionTitle
          title="진행 방식"
          hint="한 번 정하면 바꿀 수 없어요. 이미 들어온 신청의 종류가 통째로 달라지기 때문이에요."
        />

        <div className="grid gap-3 md:grid-cols-2">
          {(['INSTANT', 'BID'] as EventModeValue[]).map((value) => (
            <button
              key={value}
              type="button"
              disabled={isEdit}
              onClick={() => setEventMode(value)}
              aria-pressed={eventMode === value}
              className={cn(
                'rounded-lg border p-4 text-left transition-colors',
                eventMode === value
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-foreground/20',
                isEdit && 'cursor-not-allowed opacity-60',
              )}
            >
              <p className="font-semibold">{EVENT_MODE_LABEL[value]}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {value === 'INSTANT'
                  ? '금액을 하나로 정해 두고, 먼저 신청한 사람이 그 자리에서 확정돼요. 정원이 차면 마감돼요.'
                  : '이용자가 원하는 금액을 적어 신청해요. 마감 뒤에 금액이 높은 순으로 명단을 확정하고, 같은 금액이면 먼저 그 금액을 부른 사람이 앞서요.'}
              </p>
            </button>
          ))}
        </div>

        <InfoNote>{EVENT_MODE_HINT[eventMode]}</InfoNote>
      </section>

      {/* ─── 기본 정보 ─────────────────────────────────────────── */}
      <section className="space-y-5">
        <SectionTitle title="기본 정보" />

        {!isEdit ? (
          <Field label="시설" htmlFor="venueId" required hint="노출 중인 시설에서만 공개할 수 있어요.">
            <Select
              id="venueId"
              value={venueId}
              onChange={(event) => setVenueId(event.target.value)}
              options={venueOptions}
              placeholder="시설을 선택해 주세요"
              error={issue('venueId')}
            />
          </Field>
        ) : null}

        <Field label="제목" htmlFor="title" required>
          <Input
            id="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={80}
            placeholder="9월 셰프 테이블 8인 한정"
            error={issue('title')}
          />
        </Field>

        <Field label="소개글" htmlFor="description" required hint="무엇을 예약하는 자리인지 알려 주세요.">
          <Textarea
            id="description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={10_000}
            showCount
            rows={7}
            error={issue('description')}
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="분류" htmlFor="categoryId">
            <Select
              id="categoryId"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              options={categoryOptions}
              placeholder="선택 안 함"
            />
          </Field>

          <Field label="태그" htmlFor="tags" hint="쉼표로 구분해요. 최대 10개.">
            <Input
              id="tags"
              value={tagsText}
              onChange={(event) => setTagsText(event.target.value)}
              placeholder="오마카세, 기념일, 창가석"
            />
          </Field>
        </div>
      </section>

      {/* ─── 금액 ──────────────────────────────────────────────── */}
      <section className="space-y-5">
        <SectionTitle
          title="금액"
          hint={
            eventMode === 'INSTANT'
              ? '선착순 즉시확정은 금액을 하나로 고정해야 해요.'
              : '이용자가 이 범위 안에서 원하는 금액을 적어요. 최소·최대를 같게 두면 고정 금액이 돼요.'
          }
        />

        {eventMode === 'INSTANT' ? (
          <Field label="고정 금액" htmlFor="fixedAmount" required>
            <Input
              id="fixedAmount"
              value={fixedAmount}
              onChange={(event) => setFixedAmount(event.target.value.replace(/[^\d]/g, ''))}
              inputMode="numeric"
              trailing="원"
              placeholder="80000"
              error={issue('minAmount') ?? issue('maxAmount') ?? issue('fixedAmount')}
            />
          </Field>
        ) : (
          <>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="최소 금액" htmlFor="minAmount" required>
                <Input
                  id="minAmount"
                  value={minAmount}
                  onChange={(event) => setMinAmount(event.target.value.replace(/[^\d]/g, ''))}
                  inputMode="numeric"
                  trailing="원"
                  placeholder="50000"
                  error={issue('minAmount')}
                />
              </Field>

              <Field label="최대 금액" htmlFor="maxAmount" required>
                <Input
                  id="maxAmount"
                  value={maxAmount}
                  onChange={(event) => setMaxAmount(event.target.value.replace(/[^\d]/g, ''))}
                  inputMode="numeric"
                  trailing="원"
                  placeholder="200000"
                  error={issue('maxAmount')}
                />
              </Field>
            </div>

            <Field label="금액 단위" htmlFor="amountStep" hint="이 단위로 올려 적을 수 있어요.">
              <Input
                id="amountStep"
                value={amountStep}
                onChange={(event) => setAmountStep(event.target.value.replace(/[^\d]/g, ''))}
                inputMode="numeric"
                trailing="원"
                error={issue('amountStep')}
              />
            </Field>

            {Number.isFinite(rule.min) && Number.isFinite(rule.max) && isFixedAmount(rule) ? (
              <InfoNote>
                최소와 최대가 같아요. 이용자에게는 {formatWon(rule.min)} 고정 금액으로 보여요.
              </InfoNote>
            ) : null}
          </>
        )}

        <Field
          label="정원"
          htmlFor="capacity"
          required
          hint="정원을 넘겨서도 신청을 받아요. 최종 인원은 마감 뒤에 파트너가 정해요."
        >
          <Input
            id="capacity"
            value={capacity}
            onChange={(event) => setCapacity(event.target.value.replace(/[^\d]/g, ''))}
            inputMode="numeric"
            trailing="명"
            error={issue('capacity')}
          />
        </Field>
      </section>

      {/* ─── 기간 ──────────────────────────────────────────────── */}
      <section className="space-y-5">
        <SectionTitle title="신청 기간 · 이용일" hint="시각은 모두 한국 시간(KST) 기준이에요." />

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="신청 시작" htmlFor="applyStartAt" required>
            <DateTimeInput
              id="applyStartAt"
              value={applyStartAt}
              onChange={setApplyStartAt}
              error={issue('applyStartAt')}
            />
          </Field>

          <Field label="신청 마감" htmlFor="applyEndAt" required>
            <DateTimeInput
              id="applyEndAt"
              value={applyEndAt}
              onChange={setApplyEndAt}
              error={issue('applyEndAt')}
            />
          </Field>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="이용 시작" htmlFor="serviceStartAt" hint="신청 마감 이후여야 해요.">
            <DateTimeInput
              id="serviceStartAt"
              value={serviceStartAt}
              onChange={setServiceStartAt}
              error={issue('serviceDate') ?? issue('serviceStartAt')}
            />
          </Field>

          <Field label="이용 종료" htmlFor="serviceEndAt">
            <DateTimeInput id="serviceEndAt" value={serviceEndAt} onChange={setServiceEndAt} />
          </Field>
        </div>
      </section>

      {/* ─── 예약금 (D-05) ─────────────────────────────────────── */}
      <section className="space-y-5">
        <SectionTitle
          title="예약금"
          hint="신청을 진짜로 지킬 사람인지 확인하는 관문이에요. 순위를 정하는 건 예약금이 아니라 신청 금액이에요."
        />

        <ToggleRow
          label="예약금 받기"
          description="신청 후 정해진 시간 안에 입금해야 신청이 유효해져요. 미납이면 자동으로 만료돼요."
          checked={depositRequired}
          onChange={setDepositRequired}
        />

        {depositRequired ? (
          <div className="space-y-5 rounded-lg border p-4">
            <Field label="계산 방식" htmlFor="depositMode">
              <Select
                id="depositMode"
                value={depositMode}
                onChange={(event) => setDepositMode(event.target.value as DepositMode)}
                options={[
                  { value: 'PERCENT', label: '정률 — 신청 금액의 몇 %' },
                  { value: 'FIXED', label: '정액 — 금액과 상관없이 같은 금액' },
                ]}
              />
            </Field>

            {depositMode === 'PERCENT' ? (
              <Field
                label="비율"
                htmlFor="depositPercent"
                required
                hint="금액을 올리면 차액이 생기고, 차액을 안 내면 직전 금액으로 되돌아가요."
              >
                <Input
                  id="depositPercent"
                  value={depositPercent}
                  onChange={(event) => setDepositPercent(event.target.value.replace(/[^\d]/g, ''))}
                  inputMode="numeric"
                  trailing="%"
                  error={issue('depositValue') ?? issue('depositPercentBp')}
                />
              </Field>
            ) : (
              <Field label="금액" htmlFor="depositFixedAmount" required>
                <Input
                  id="depositFixedAmount"
                  value={depositFixedAmount}
                  onChange={(event) =>
                    setDepositFixedAmount(event.target.value.replace(/[^\d]/g, ''))
                  }
                  inputMode="numeric"
                  trailing="원"
                  error={issue('depositValue') ?? issue('depositFixedAmount')}
                />
              </Field>
            )}

            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                label="입금 시간"
                htmlFor="depositWindowMinutes"
                required
                hint="진행 중에는 줄일 수 없어요."
              >
                <Input
                  id="depositWindowMinutes"
                  value={depositWindowMinutes}
                  onChange={(event) =>
                    setDepositWindowMinutes(event.target.value.replace(/[^\d]/g, ''))
                  }
                  inputMode="numeric"
                  trailing="분"
                  error={issue('depositWindowMinutes')}
                />
              </Field>

              <Field label="절사 단위" htmlFor="depositRoundingUnit" hint="계산된 금액을 이 단위로 내려 맞춰요.">
                <Input
                  id="depositRoundingUnit"
                  value={depositRoundingUnit}
                  onChange={(event) =>
                    setDepositRoundingUnit(event.target.value.replace(/[^\d]/g, ''))
                  }
                  inputMode="numeric"
                  trailing="원"
                />
              </Field>
            </div>

            {depositPreview ? (
              <InfoNote title="예상 예약금">
                {formatWon(depositPreview.sample)}에 신청하면 약{' '}
                <strong className="text-foreground">{formatWon(depositPreview.amount)}</strong>을
                입금해야 해요. (절사 단위에 따라 조금 달라질 수 있어요)
              </InfoNote>
            ) : null}

            <Field
              label="환불 안내"
              htmlFor="depositRefundNote"
              hint="미당첨자 예약금은 환불돼요. 그 밖의 안내가 있으면 적어 주세요."
            >
              <Textarea
                id="depositRefundNote"
                value={depositRefundNote}
                onChange={(event) => setDepositRefundNote(event.target.value)}
                maxLength={500}
                showCount
                rows={3}
              />
            </Field>
          </div>
        ) : null}
      </section>

      {/* ─── 자동 연장 (D-08) ──────────────────────────────────── */}
      {eventMode === 'BID' ? (
        <section className="space-y-5">
          <SectionTitle
            title="자동 연장 (소프트 클로즈)"
            hint="마감 직전에 몰리는 걸 막아 줘요."
          />

          <InfoNote title="왜 필요한가요?">
            금액이 높은 순으로 정해지니까, 먼저 적으면 추월당할 뿐이라 다들 마지막 1분을 노려요.
            그러면 서버도 몰리고 늦게 본 사람은 손도 못 써요. 마감 직전에 새 신청이나 금액 올리기가
            들어오면 마감을 조금 미뤄서, 남은 사람에게도 대응할 시간을 주는 장치예요.
          </InfoNote>

          <ToggleRow
            label="자동 연장 켜기"
            description="마감 직전 신청이 들어오면 마감 시각을 미뤄요."
            checked={softCloseEnabled}
            onChange={setSoftCloseEnabled}
          />

          {softCloseEnabled ? (
            <div className="space-y-5 rounded-lg border p-4">
              <div className="grid gap-5 sm:grid-cols-2">
                <Field
                  label="감지 시간"
                  htmlFor="softCloseWindowMinutes"
                  required
                  hint="마감 몇 분 전의 신청을 연장 대상으로 볼지."
                >
                  <Input
                    id="softCloseWindowMinutes"
                    value={softCloseWindowMinutes}
                    onChange={(event) =>
                      setSoftCloseWindowMinutes(event.target.value.replace(/[^\d]/g, ''))
                    }
                    inputMode="numeric"
                    trailing="분"
                    error={issue('softCloseWindowMinutes')}
                  />
                </Field>

                <Field label="연장 폭" htmlFor="softCloseExtendMinutes" required hint="한 번에 얼마나 미룰지.">
                  <Input
                    id="softCloseExtendMinutes"
                    value={softCloseExtendMinutes}
                    onChange={(event) =>
                      setSoftCloseExtendMinutes(event.target.value.replace(/[^\d]/g, ''))
                    }
                    inputMode="numeric"
                    trailing="분"
                    error={issue('softCloseExtendMinutes')}
                  />
                </Field>
              </div>

              <Field
                label="최종 마감 시각"
                htmlFor="softCloseHardEndAt"
                required
                hint="아무리 연장돼도 이 시각은 넘지 않아요. 연장을 켜면 반드시 정해야 해요."
              >
                <DateTimeInput
                  id="softCloseHardEndAt"
                  value={softCloseHardEndAt}
                  onChange={setSoftCloseHardEndAt}
                  error={issue('softCloseHardEndAt')}
                />
              </Field>

              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="전체 연장 횟수 상한" htmlFor="softCloseMaxExtensions">
                  <Input
                    id="softCloseMaxExtensions"
                    value={softCloseMaxExtensions}
                    onChange={(event) =>
                      setSoftCloseMaxExtensions(event.target.value.replace(/[^\d]/g, ''))
                    }
                    inputMode="numeric"
                    trailing="회"
                  />
                </Field>

                <Field
                  label="1인당 연장 횟수 상한"
                  htmlFor="softCloseMaxExtensionsPerUser"
                  hint="한 사람이 계속 미루는 걸 막아요."
                >
                  <Input
                    id="softCloseMaxExtensionsPerUser"
                    value={softCloseMaxExtensionsPerUser}
                    onChange={(event) =>
                      setSoftCloseMaxExtensionsPerUser(event.target.value.replace(/[^\d]/g, ''))
                    }
                    inputMode="numeric"
                    trailing="회"
                    error={issue('softCloseMaxExtensionsPerUser')}
                  />
                </Field>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* ─── 공개 정책 (D-07) ──────────────────────────────────── */}
      <section className="space-y-5">
        <SectionTitle
          title="경쟁률 공개"
          hint="신청 기간에 이용자가 볼 수 있는 건 경쟁률뿐이에요. 금액·순위·커트라인은 공개되지 않아요."
        />

        <ToggleRow
          label="경쟁률 보여주기"
          description="정원 대비 신청 인원을 '4.7:1' 처럼 보여줘요."
          checked={showCompetitionRatio}
          onChange={setShowCompetitionRatio}
        />

        {showCompetitionRatio ? (
          <Field
            label="최소 신청 인원"
            htmlFor="ratioMinApplicantsToShow"
            hint="이 인원보다 적으면 경쟁률을 감춰요. 한두 명일 때의 경쟁률은 사실상 개인 정보예요."
          >
            <Input
              id="ratioMinApplicantsToShow"
              value={ratioMinApplicantsToShow}
              onChange={(event) =>
                setRatioMinApplicantsToShow(event.target.value.replace(/[^\d]/g, ''))
              }
              inputMode="numeric"
              trailing="명"
            />
          </Field>
        ) : null}
      </section>

      <div className="sticky bottom-0 -mx-4 flex flex-col-reverse gap-2 border-t bg-background/95 px-4 py-4 backdrop-blur sm:flex-row sm:justify-end md:-mx-6 md:px-6">
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

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div>
      <h2 className="text-base font-bold">{title}</h2>
      {hint ? <FieldHint className="mt-1">{hint}</FieldHint> : null}
    </div>
  );
}

/** 한국 시간 벽시계 입력. Input 프리미티브는 datetime-local 의 네이티브 피커와 궁합이 나쁘다. */
function DateTimeInput({
  id,
  value,
  onChange,
  error,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  return (
    <div className="w-full">
      <input
        id={id}
        type="datetime-local"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        className={cn(
          'h-12 w-full rounded-lg border bg-background px-3 text-base outline-none',
          'focus:ring-2 focus:ring-ring focus:ring-offset-1 focus:ring-offset-background',
          error ? 'border-destructive' : 'border-input',
        )}
      />
      {error ? <p className="mt-1.5 text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-4">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-5 w-5 shrink-0 accent-[hsl(var(--primary))]"
      />
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        <span className="mt-0.5 block text-sm leading-relaxed text-muted-foreground">
          {description}
        </span>
      </span>
    </label>
  );
}

/** 금액 상한(서버 CHECK 와 같은 값). 안내 문구에서 쓴다. */
export const EVENT_AMOUNT_MAX = AMOUNT_MAX;
