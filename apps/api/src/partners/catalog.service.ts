import { Injectable } from '@nestjs/common';
import { Prisma, RegionLevel } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import type { ListCategoriesQueryDto, ListRegionsQueryDto } from './dto/catalog.dto';

const CATEGORY_SELECT = {
  id: true,
  code: true,
  nameKo: true,
  nameEn: true,
  iconKey: true,
  sortOrder: true,
  parentId: true,
} satisfies Prisma.CategorySelect;

type CategoryRow = Prisma.CategoryGetPayload<{ select: typeof CATEGORY_SELECT }>;

/**
 * Category / Region 마스터 조회. **읽기 전용**이다 — 쓰기는 운영자 모듈이 갖는다.
 *
 * 이 두 목록이 여기 있는 이유는 시설 등록 폼이 이것 없이는 아무것도 못 하기 때문이고,
 * 로그인 전 탐색 화면의 필터도 같은 목록을 쓰므로 공개(@Public)로 연다.
 * 비활성(isActive=false)·삭제된 항목은 어떤 경로로도 나가지 않는다 —
 * 폼에 뜬 항목을 골랐는데 저장 단계에서 거부당하는 상황을 만들지 않기 위해서다.
 */
@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async listCategories(query: ListCategoriesQueryDto) {
    if (query.parentId) {
      const children = await this.prisma.category.findMany({
        where: { parentId: query.parentId, isActive: true, deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { nameKo: 'asc' }],
        select: CATEGORY_SELECT,
      });

      return children.map((child) => ({ ...child, children: [] }));
    }

    // 트리는 최대 2단계다(schema.prisma). 그래서 재귀 CTE 없이 한 번에 읽고 메모리에서 엮는다.
    const rows = await this.prisma.category.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { nameKo: 'asc' }],
      select: CATEGORY_SELECT,
    });

    return buildCategoryTree(rows);
  }

  /**
   * 지역 목록.
   *
   * 기본이 SIDO 인 이유: 시/군/구는 전국 250여 개라 한 번에 내리면 셀렉트 박스가 쓸모없어진다.
   * 시설에 실제로 붙일 수 있는 건 SIGUNGU 뿐이다(001_constraints.sql 12-3).
   */
  async listRegions(query: ListRegionsQueryDto) {
    const rows = await this.prisma.region.findMany({
      where: {
        isActive: true,
        level: query.level ?? RegionLevel.SIDO,
        ...(query.parentCode ? { parentCode: query.parentCode } : {}),
      },
      orderBy: [{ sido: 'asc' }, { displayName: 'asc' }],
      select: {
        code: true,
        level: true,
        displayName: true,
        sido: true,
        sigungu: true,
        sigunguCode: true,
        parentCode: true,
      },
    });

    return rows;
  }
}

function buildCategoryTree(rows: CategoryRow[]) {
  const byParent = new Map<string, CategoryRow[]>();

  for (const row of rows) {
    if (!row.parentId) continue;
    const bucket = byParent.get(row.parentId) ?? [];
    bucket.push(row);
    byParent.set(row.parentId, bucket);
  }

  return rows
    .filter((row) => row.parentId === null)
    .map((root) => ({
      ...root,
      // 부모가 비활성이면 자식도 목록에서 사라진다 — 위 where 가 부모를 이미 걸렀으므로
      // 여기서는 고아 자식이 루트로 승격되지 않는 것만 보장하면 된다.
      children: (byParent.get(root.id) ?? []).map((child) => ({ ...child, children: [] })),
    }));
}
