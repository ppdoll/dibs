import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, AuditTargetType, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { AdminAuditService } from './admin-audit.service';
import type {
  CreateCategoryDto,
  ReorderCategoriesDto,
  UpdateCategoryDto,
} from '../dto/category-admin.dto';

const SELECT = {
  id: true,
  code: true,
  nameKo: true,
  nameEn: true,
  iconKey: true,
  sortOrder: true,
  isActive: true,
  parentId: true,
} satisfies Prisma.CategorySelect;

/**
 * 업종(Category) 관리. (D-02 · IC-65 와 같은 결)
 *
 * 업종은 시설·이벤트가 참조하는 마스터 데이터다. 그래서 이 화면의 규칙은 두 가지다.
 *
 *   1. **끄기(isActive=false)가 기본 수단이고, 삭제는 예외다.**
 *      쓰는 데가 있는 업종을 지우면 그 시설·이벤트가 갈 곳을 잃는다. 끄면 신규 등록과
 *      검색 필터에서만 사라지고 기존 데이터는 그대로 산다.
 *   2. **code 는 바꿀 수 없다.**
 *      시드와 마이그레이션이 code 를 자연키로 쓰고, 검색 URL 에도 그대로 실린다.
 *      바꾸면 저장된 링크와 북마크가 조용히 깨진다. 이름만 고치면 되는 경우가 대부분이다.
 */
@Injectable()
export class AdminCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  /**
   * 2단계 트리로 돌려준다. 화면이 다시 조립하지 않아도 되게.
   *
   * ★ 시설 수는 `Category.venueCount`(비정규화 캐시)를 쓰지 않고 **실측한다.**
   *
   * 이 화면의 숫자는 눌러서 가는 목록(`/admin/venues?categoryId=…`)과 반드시 같아야 한다.
   * 캐시는 시설을 지우거나 업종을 옮길 때 갱신을 한 군데라도 빠뜨리면 조용히 어긋나고,
   * 그때 운영자는 "시설 1곳"을 눌렀는데 빈 목록을 보게 된다. (실제로 그 상태가 있었다.)
   * 업종은 많아야 수십 개짜리 마스터 데이터라 매번 세도 부담이 없다.
   *
   * 세는 조건은 목록 필터와 **글자 그대로 같다** — 대표 업종이거나 보조 업종이거나.
   * 둘 다인 시설이 두 번 세지지 않도록 EXISTS 로 붙인다(JOIN 이면 중복된다).
   */
  async listTree(includeInactive: boolean) {
    const where: Prisma.CategoryWhereInput = {
      deletedAt: null,
      ...(includeInactive ? {} : { isActive: true }),
    };

    const rows = await this.prisma.category.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { nameKo: 'asc' }],
      select: { ...SELECT, _count: { select: { events: true } } },
    });

    const venueCounts = await this.countVenuesByCategory(rows.map((r) => r.id));

    const toDto = (r: (typeof rows)[number]) => ({
      id: r.id,
      code: r.code,
      nameKo: r.nameKo,
      nameEn: r.nameEn,
      iconKey: r.iconKey,
      sortOrder: r.sortOrder,
      isActive: r.isActive,
      parentId: r.parentId,
      venueCount: venueCounts.get(r.id) ?? 0,
      eventCount: r._count.events,
    });

    const roots = rows.filter((r) => r.parentId === null).map(toDto);
    const byParent = new Map<string, ReturnType<typeof toDto>[]>();

    for (const r of rows) {
      if (r.parentId === null) continue;
      const list = byParent.get(r.parentId) ?? [];
      list.push(toDto(r));
      byParent.set(r.parentId, list);
    }

    return roots.map((root) => ({ ...root, children: byParent.get(root.id) ?? [] }));
  }

  /**
   * 업종별 시설 수 실측. `/admin/venues?categoryId=…` 의 WHERE 와 같은 조건이다.
   *
   * `_VenueSecondaryCategories` 는 Prisma 가 만든 암묵적 m-n 조인 테이블이다.
   * 컬럼 A/B 는 모델명 알파벳 순이라 A=Category.id, B=Venue.id 다.
   * JOIN 대신 EXISTS 를 쓰는 이유: 대표이자 보조인 시설이 두 번 세지면 안 된다.
   */
  private async countVenuesByCategory(ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();

    const rows = await this.prisma.$queryRaw<Array<{ id: string; n: number }>>`
      SELECT c.id,
             (
               SELECT count(*)::int
               FROM "Venue" v
               WHERE v."deletedAt" IS NULL
                 AND (
                   v."primaryCategoryId" = c.id
                   OR EXISTS (
                     SELECT 1 FROM "_VenueSecondaryCategories" j
                     WHERE j."A" = c.id AND j."B" = v.id
                   )
                 )
             ) AS n
      FROM "Category" c
      WHERE c.id = ANY(${ids})
    `;

    return new Map(rows.map((r) => [r.id, r.n]));
  }

  async create(admin: AuthenticatedUser, dto: CreateCategoryDto) {
    // 트리를 2단계로 묶는다. 3단계부터는 화면(칩 한 줄 + 하위 목록)이 표현하지 못하고,
    // 검색 필터도 "상위를 고르면 하위 전부"라는 단순한 규칙을 못 쓰게 된다.
    if (dto.parentId) {
      const parent = await this.prisma.category.findFirst({
        where: { id: dto.parentId, deletedAt: null },
        select: { id: true, parentId: true },
      });

      if (!parent) throw new BadRequestException('상위 업종을 찾을 수 없습니다.');
      if (parent.parentId !== null) {
        throw new BadRequestException('업종은 2단계까지만 만들 수 있습니다.');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      // code 유니크는 부분 유니크(WHERE deletedAt IS NULL)라 Prisma 가 모른다.
      // 살아 있는 행만 보고 미리 걸러 사람이 읽는 메시지를 준다. 경합은 아래 P2002 가 받는다.
      const dup = await tx.category.findFirst({
        where: { code: dto.code, deletedAt: null },
        select: { id: true },
      });
      if (dup) throw new ConflictException(`이미 쓰고 있는 코드입니다: ${dto.code}`);

      const created = await tx.category.create({
        data: {
          code: dto.code,
          nameKo: dto.nameKo,
          nameEn: dto.nameEn ?? null,
          iconKey: dto.iconKey ?? null,
          parentId: dto.parentId ?? null,
          sortOrder: dto.sortOrder ?? 0,
        },
        select: SELECT,
      });

      await this.audit.append(tx, admin, {
        action: AuditAction.CATEGORY_CREATED,
        summary: `업종 추가: ${created.nameKo} (${created.code})`,
        targetType: AuditTargetType.SETTING,
        targetId: created.id,
        after: created,
      });

      return created;
    });
  }

  async update(admin: AuthenticatedUser, id: string, dto: UpdateCategoryDto) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.category.findFirst({
        where: { id, deletedAt: null },
        select: SELECT,
      });
      if (!before) throw new NotFoundException('업종을 찾을 수 없습니다.');

      const after = await tx.category.update({
        where: { id },
        data: {
          ...(dto.nameKo !== undefined ? { nameKo: dto.nameKo } : {}),
          ...(dto.nameEn !== undefined ? { nameEn: dto.nameEn } : {}),
          ...(dto.iconKey !== undefined ? { iconKey: dto.iconKey } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
        select: SELECT,
      });

      // 값이 실제로 안 바뀌었으면 감사 행을 남기지 않는다. 저장을 두 번 눌렀다고
      // "두 번 바꿈"으로 기록되면 체인이 의미 없는 행으로 부푼다. (IC-65 와 같은 규칙)
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        await this.audit.append(tx, admin, {
          action:
            dto.isActive === false
              ? AuditAction.CATEGORY_DEACTIVATED
              : AuditAction.CATEGORY_UPDATED,
          summary:
            dto.isActive === false
              ? `업종 비활성: ${after.nameKo} (${after.code})`
              : `업종 수정: ${after.nameKo} (${after.code})`,
          targetType: AuditTargetType.SETTING,
          targetId: id,
          before,
          after,
        });
      }

      return after;
    });
  }

  /**
   * 순서 재배치.
   *
   * 같은 depth 전체를 받아 index 를 그대로 sortOrder 로 쓴다. 한 건씩 올리고 내리면
   * 중간에 실패했을 때 순서가 뒤엉킨 채 남는다. 전체를 한 트랜잭션에서 다시 쓴다.
   * (Venue/Event 이미지와 달리 sortOrder 에 유니크가 없어 음수 대피가 필요 없다.)
   */
  async reorder(admin: AuthenticatedUser, dto: ReorderCategoriesDto) {
    const ids = dto.orderedIds;
    if (ids.length === 0) throw new BadRequestException('순서를 지정할 업종이 없습니다.');
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('같은 업종이 두 번 들어 있습니다.');
    }

    return this.prisma.$transaction(async (tx) => {
      const found = await tx.category.findMany({
        where: { id: { in: ids }, deletedAt: null },
        select: { id: true, parentId: true },
      });

      if (found.length !== ids.length) {
        throw new BadRequestException('없는 업종이 섞여 있습니다. 화면을 새로고침해 주세요.');
      }

      // 서로 다른 depth 를 한 번에 섞으면 "형제들 사이의 순서"라는 의미가 깨진다.
      const parents = new Set(found.map((f) => f.parentId));
      if (parents.size > 1) {
        throw new BadRequestException('같은 단계의 업종만 함께 정렬할 수 있습니다.');
      }

      for (const [index, id] of ids.entries()) {
        await tx.category.update({ where: { id }, data: { sortOrder: index } });
      }

      await this.audit.append(tx, admin, {
        action: AuditAction.CATEGORY_UPDATED,
        summary: `업종 순서 재배치 ${ids.length}건`,
        targetType: AuditTargetType.SETTING,
        targetId: [...parents][0] ?? 'root',
        after: { reordered: ids },
      });

      return { reordered: ids.length };
    });
  }

  /**
   * 소프트 삭제. 쓰는 데가 하나라도 있으면 거부한다.
   *
   * 끄기(isActive=false)로 충분한 경우가 대부분이라, 삭제는 "만들자마자 잘못 만든 것"을
   * 치우는 용도다. 그래서 조건을 느슨하게 두지 않는다.
   */
  async remove(admin: AuthenticatedUser, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.category.findFirst({
        where: { id, deletedAt: null },
        select: {
          ...SELECT,
          _count: { select: { events: true, children: true, secondaryVenues: true } },
        },
      });
      if (!target) throw new NotFoundException('업종을 찾을 수 없습니다.');

      // 캐시(Category.venueCount)가 아니라 실측을 쓴다. 캐시가 낡으면 지울 수 있는
      // 업종을 못 지우거나(유령 카운트) 쓰이는 업종을 지워버린다(0으로 낡은 경우).
      const primaryVenues = await tx.venue.count({
        where: { primaryCategoryId: id, deletedAt: null },
      });

      const blockers: string[] = [];
      if (primaryVenues > 0) blockers.push(`시설 ${primaryVenues}곳`);
      if (target._count.secondaryVenues > 0) {
        blockers.push(`보조 업종으로 쓰는 시설 ${target._count.secondaryVenues}곳`);
      }
      if (target._count.events > 0) blockers.push(`이벤트 ${target._count.events}건`);
      if (target._count.children > 0) blockers.push(`하위 업종 ${target._count.children}개`);

      if (blockers.length > 0) {
        throw new ConflictException({
          code: 'CATEGORY_IN_USE',
          message: `${blockers.join(', ')}이(가) 이 업종을 쓰고 있어 삭제할 수 없습니다. 대신 비활성으로 바꾸면 신규 등록과 검색에서만 사라집니다.`,
        });
      }

      await tx.category.update({
        where: { id },
        // 코드를 비워 주지 않으면 같은 코드로 다시 만들 수 없다고 오해하기 쉬운데,
        // code 유니크가 부분(WHERE deletedAt IS NULL)이라 지운 뒤에는 자리가 반납된다.
        data: { deletedAt: new Date(), isActive: false },
      });

      await this.audit.append(tx, admin, {
        action: AuditAction.CATEGORY_DEACTIVATED,
        summary: `업종 삭제: ${target.nameKo} (${target.code})`,
        targetType: AuditTargetType.SETTING,
        targetId: id,
        before: target,
        after: { deleted: true },
      });

      return { deleted: true };
    });
  }
}
