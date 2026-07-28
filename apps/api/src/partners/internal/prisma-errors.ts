import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * 이 모듈이 부딪히는 유니크는 전부 **부분 유니크**(`WHERE "deletedAt" IS NULL`)이고
 * schema.prisma 가 아니라 prisma/sql/001_constraints.sql §10 에 산다.
 *
 * 그래서 Prisma 는 이걸 필드 유니크로 인식하지 못한다 — `meta.target` 에 필드명이 아니라
 * **인덱스 이름**이 실려 오고, raw 경로에서는 아예 P2010(23505)으로 온다.
 * 전역 예외 필터의 "이미 존재하는 값입니다"로 뭉뚱그리면 파트너가 무엇이 겹쳤는지 알 수 없다.
 */
const UNIQUE_MESSAGES: Record<string, string> = {
  business_brn_uq: '이미 등록된 사업자등록번호입니다. 같은 번호로 다시 등록하려면 기존 사업자를 삭제해 주세요.',
  venue_business_name_live_uq: '같은 사업자 아래에 같은 이름의 시설이 이미 있습니다.',
  venue_slug_uq: '시설 주소(slug)가 방금 다른 시설에 배정되었습니다. 다시 시도해 주세요.',
  venue_image_pathname_uq: '이미 등록된 업로드 경로입니다.',
  venue_image_order_live_uq: '이미지 순서가 다른 요청과 겹쳤습니다. 목록을 새로고침한 뒤 다시 시도해 주세요.',
};

/**
 * 유니크 위반을 사람이 읽을 수 있는 409 로 바꿔서 다시 던진다.
 * 매칭되는 인덱스가 없으면 원래 오류를 그대로 흘려보낸다 — 삼키면 진짜 버그가 숨는다.
 */
export async function mapUniqueViolation<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const conflict = toConflict(error);
    throw conflict ?? error;
  }
}

function toConflict(error: unknown): ConflictException | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null;

  const haystack = describe(error);
  if (!haystack) return null;

  for (const [index, message] of Object.entries(UNIQUE_MESSAGES)) {
    if (haystack.includes(index)) {
      return new ConflictException({ code: index.toUpperCase(), message });
    }
  }

  return null;
}

/**
 * P2002(Prisma 가 해석한 유니크 위반)와 P2010(raw 쿼리 실패) 두 경로에서
 * 인덱스 이름이 실려 오는 자리가 다르다. 둘을 한 문자열로 눌러서 찾는다.
 */
function describe(error: Prisma.PrismaClientKnownRequestError): string | null {
  if (error.code === 'P2002') {
    const target = error.meta?.['target'];
    if (typeof target === 'string') return target;
    if (Array.isArray(target)) return target.join(',');
    return null;
  }

  if (error.code === 'P2010') {
    const meta = error.meta ?? {};
    if (meta['code'] !== '23505') return null;
    return typeof meta['message'] === 'string' ? meta['message'] : error.message;
  }

  return null;
}
