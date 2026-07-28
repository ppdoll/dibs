import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, AuditTargetType, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { auditChainKey } from '../admin.internals';
import type { UpsertSettingDto } from '../dto/setting-admin.dto';
import { AdminAuditService } from './admin-audit.service';

/**
 * 피처 플래그. (IC-65)
 *
 * env 가 아니라 테이블에 두는 이유는 세 가지다 — 재배포 없이 끌 수 있어야 하고,
 * 누가 언제 껐는지 남아야 하고, 무엇보다 `Deposit.featureFlagSnapshot` 이
 * "그 홀드를 만들 때 값이 뭐였는지"를 나중에 복원할 수 있어야 한다(D-05 가 PG 연동을
 * 유보한 상태에서 그 스냅샷은 실제 결제로 넘어갈 때의 유일한 기준선이다).
 */
export const FEATURE_FLAG_KEYS = [
  'DEPOSIT_HOLD_ENABLED',
  'SETTLEMENT_ENABLED',
  'EVENT_ADVANCED_VISIBILITY_ENABLED',
] as const;

export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number];

type SettingKind = 'boolean' | 'number' | 'string';

interface SettingSpec {
  kind: SettingKind;
  fallback: unknown;
  description: string;
  /** number 전용 범위. 밖이면 저장 자체를 거부한다. */
  min?: number;
  max?: number;
}

/**
 * 알려진 키 목록.
 *
 * 화이트리스트인 이유: `Setting` 은 key 가 PK 인 자유 저장소라, 오타 하나로
 * `DEPOSIT_HOLD_ENABLE` 같은 유령 키가 조용히 생긴다. 그러면 읽는 쪽은 계속
 * fallback 을 쓰는데 콘솔에는 "켜짐"으로 보인다 — 가장 나쁜 종류의 불일치다.
 */
const SETTING_REGISTRY: Record<string, SettingSpec> = {
  DEPOSIT_HOLD_ENABLED: {
    kind: 'boolean',
    fallback: false,
    description: '예약금 실제 결제(PG) 연동 사용 여부. D-05 에 따라 기본 꺼짐.',
  },
  SETTLEMENT_ENABLED: {
    kind: 'boolean',
    fallback: false,
    description: '정산 계산·지급 사용 여부. 지금은 데이터 자리만 있다.',
  },
  EVENT_ADVANCED_VISIBILITY_ENABLED: {
    kind: 'boolean',
    fallback: false,
    description: '커트라인/내 순위 공개 토글을 파트너에게 노출할지 (D-07 의 보류 항목).',
  },
  BROADCAST_REQUIRES_APPROVAL: {
    kind: 'boolean',
    fallback: false,
    description: '운영자 공지 발송 전에 다른 운영자의 승인을 요구할지.',
  },
  PARTNER_REVIEW_SLA_HOURS: {
    kind: 'number',
    fallback: 72,
    min: 1,
    max: 720,
    description: '파트너 심사 목표 처리 시간(시간).',
  },
  SUPPORT_CONTACT_EMAIL: {
    kind: 'string',
    fallback: 'support@dibs.kr',
    description: '알림 문구에 넣는 고객센터 주소.',
  },
};

/** 캐시 수명. 인스턴스가 짧게 살고 죽는 서버리스라 이 정도면 충분하다. (IC-65) */
const DEFAULT_TTL_MS = 30_000;

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

/**
 * 런타임 설정 저장소 + 짧은 캐시.
 *
 * 캐시가 필요한 이유는 콜드스타트마다 읽으면 플래그 조회가 요청당 1쿼리가 되기 때문이고,
 * 30초로 짧게 잡은 이유는 즉시성이 필요한 플래그가 없기 때문이다.
 * 쓰기는 캐시를 즉시 무효화하지만, **다른 인스턴스의 캐시까지 끄지는 못한다** —
 * 그래서 최대 30초의 전파 지연이 설계상 허용된 값이다.
 */
@Injectable()
export class AdminSettingsService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  /** 불리언 플래그 읽기. 키가 없거나 타입이 어긋나면 fallback 이다 — 던지지 않는다. */
  async getBool(key: string, options?: { ttlMs?: number; fallback?: boolean }): Promise<boolean> {
    const spec = SETTING_REGISTRY[key];
    const fallback = options?.fallback ?? (typeof spec?.fallback === 'boolean' ? spec.fallback : false);
    const value = await this.readCached(key, options?.ttlMs ?? DEFAULT_TTL_MS);

    return typeof value === 'boolean' ? value : fallback;
  }

  /** 숫자 설정 읽기. */
  async getNumber(key: string, options?: { ttlMs?: number; fallback?: number }): Promise<number> {
    const spec = SETTING_REGISTRY[key];
    const fallback = options?.fallback ?? (typeof spec?.fallback === 'number' ? spec.fallback : 0);
    const value = await this.readCached(key, options?.ttlMs ?? DEFAULT_TTL_MS);

    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  /** 문자열 설정 읽기. */
  async getString(key: string, options?: { ttlMs?: number; fallback?: string }): Promise<string> {
    const spec = SETTING_REGISTRY[key];
    const fallback = options?.fallback ?? (typeof spec?.fallback === 'string' ? spec.fallback : '');
    const value = await this.readCached(key, options?.ttlMs ?? DEFAULT_TTL_MS);

    return typeof value === 'string' ? value : fallback;
  }

  /**
   * 콘솔 목록. 저장된 행이 없는 키도 "기본값 사용 중"으로 함께 보여준다 —
   * 목록에 안 보이는 플래그는 존재하지 않는 플래그가 되기 때문이다.
   */
  async list() {
    const rows = await this.prisma.setting.findMany({ orderBy: { key: 'asc' } });
    const stored = new Map(rows.map((row) => [row.key, row]));

    const known = Object.entries(SETTING_REGISTRY).map(([key, spec]) => {
      const row = stored.get(key);

      return {
        key,
        kind: spec.kind,
        isFeatureFlag: (FEATURE_FLAG_KEYS as readonly string[]).includes(key),
        value: row ? row.valueJson : (spec.fallback as Prisma.JsonValue),
        isDefault: !row,
        description: row?.description ?? spec.description,
        updatedByUserId: row?.updatedByUserId ?? null,
        updatedAt: row?.updatedAt ?? null,
      };
    });

    // 레지스트리에 없는데 DB 에는 있는 키(과거 실험 등)도 숨기지 않는다.
    const orphans = rows
      .filter((row) => !(row.key in SETTING_REGISTRY))
      .map((row) => ({
        key: row.key,
        kind: 'string' as SettingKind,
        isFeatureFlag: false,
        value: row.valueJson,
        isDefault: false,
        description: row.description ?? '레지스트리에 없는 키 — 사용처를 확인한 뒤 지우세요.',
        updatedByUserId: row.updatedByUserId,
        updatedAt: row.updatedAt,
      }));

    return { items: [...known, ...orphans] };
  }

  async get(key: string) {
    const spec = SETTING_REGISTRY[key];
    const row = await this.prisma.setting.findUnique({ where: { key } });

    if (!row && !spec) throw new NotFoundException('알 수 없는 설정 키입니다.');

    return {
      key,
      value: row ? row.valueJson : ((spec?.fallback ?? null) as Prisma.JsonValue),
      isDefault: !row,
      description: row?.description ?? spec?.description ?? null,
      updatedByUserId: row?.updatedByUserId ?? null,
      updatedAt: row?.updatedAt ?? null,
    };
  }

  /**
   * 설정 쓰기. (IC-65)
   *
   * 감사 행의 action 을 키로 나눈다 — 피처 플래그는 `FEATURE_FLAG_TOGGLED`, 나머지는
   * `SETTING_CHANGED`. before/after JSON 을 둘 다 남겨야 "언제부터 이 값이었나"를
   * 로그만 보고 재구성할 수 있다.
   *
   * 값이 실제로 바뀌지 않았으면 감사 행을 쓰지 않는다. 안 그러면 콘솔에서 저장을 두 번
   * 누른 것이 "두 번 바꿈"으로 남아 체인이 의미 없는 행으로 부푼다.
   */
  async upsert(admin: AuthenticatedUser, key: string, dto: UpsertSettingDto) {
    const spec = SETTING_REGISTRY[key];

    if (!spec) {
      throw new BadRequestException({
        code: 'UNKNOWN_SETTING_KEY',
        message: '알 수 없는 설정 키입니다. 코드의 SETTING_REGISTRY 에 먼저 등록해야 합니다.',
      });
    }

    const value = coerce(key, dto.value, spec);
    const isFlag = (FEATURE_FLAG_KEYS as readonly string[]).includes(key);

    const result = await this.prisma.$transaction(async (tx) => {
      await this.audit.lock(tx, auditChainKey(AuditTargetType.SETTING));

      const before = await tx.setting.findUnique({ where: { key } });
      const unchanged = before !== null && JSON.stringify(before.valueJson) === JSON.stringify(value);

      const row = await tx.setting.upsert({
        where: { key },
        create: {
          key,
          valueJson: value as Prisma.InputJsonValue,
          description: dto.description ?? spec.description,
          updatedByUserId: admin.id,
        },
        update: {
          valueJson: value as Prisma.InputJsonValue,
          ...(dto.description ? { description: dto.description } : {}),
          updatedByUserId: admin.id,
        },
      });

      if (!unchanged) {
        await this.audit.append(tx, admin, {
          action: isFlag ? AuditAction.FEATURE_FLAG_TOGGLED : AuditAction.SETTING_CHANGED,
          targetType: AuditTargetType.SETTING,
          // targetId 가 key 다 — Setting 에는 별도 id 가 없고, 키가 곧 대상이다.
          targetId: key,
          summary: `설정 변경 ${key}: ${JSON.stringify(before?.valueJson ?? spec.fallback)} → ${JSON.stringify(value)}`,
          before: { value: before?.valueJson ?? spec.fallback, isDefault: before === null },
          after: { value },
          reasonMemo: dto.reason,
        });
      }

      return row;
    });

    // 이 인스턴스의 캐시만 즉시 무효화된다. 다른 인스턴스는 TTL 만큼 뒤처진다(설계상 허용).
    this.cache.delete(key);

    return {
      key: result.key,
      value: result.valueJson,
      isDefault: false,
      description: result.description,
      updatedAt: result.updatedAt,
    };
  }

  private async readCached(key: string, ttlMs: number): Promise<unknown> {
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    const row = await this.prisma.setting.findUnique({
      where: { key },
      select: { valueJson: true },
    });

    // 행이 없는 것도 캐시한다. 안 그러면 "아직 저장 안 된 플래그"가 매 요청 1쿼리가 된다.
    const value = row ? row.valueJson : undefined;
    this.cache.set(key, { value, expiresAt: Date.now() + ttlMs });

    return value;
  }
}

/** 레지스트리가 선언한 타입으로 좁힌다. 여기서 막지 않으면 jsonb 는 무엇이든 받아들인다. */
function coerce(key: string, raw: unknown, spec: SettingSpec): boolean | number | string {
  if (spec.kind === 'boolean') {
    if (typeof raw !== 'boolean') {
      throw new BadRequestException(`${key} 는 boolean 이어야 합니다.`);
    }
    return raw;
  }

  if (spec.kind === 'number') {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      throw new BadRequestException(`${key} 는 숫자여야 합니다.`);
    }
    if ((spec.min !== undefined && raw < spec.min) || (spec.max !== undefined && raw > spec.max)) {
      throw new BadRequestException(`${key} 는 ${spec.min ?? '-∞'}~${spec.max ?? '∞'} 범위여야 합니다.`);
    }
    return raw;
  }

  if (typeof raw !== 'string' || raw.length > 500) {
    throw new BadRequestException(`${key} 는 500자 이하 문자열이어야 합니다.`);
  }

  return raw;
}
