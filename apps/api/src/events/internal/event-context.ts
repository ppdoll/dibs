import { ForbiddenException, HttpException } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';

import type { AuthenticatedUser } from '../../common/types/authenticated-user';

/**
 * 요청 주체의 파트너 프로필 id.
 *
 * 모든 소유권 검사는 이 값을 **WHERE 절에** 넣어서 한다. "이 이벤트가 내 것인가"를 별도
 * SELECT 로 먼저 확인하면 그 사이가 경합 창이고, 무엇보다 새 핸들러를 추가할 때 그 SELECT 를
 * 빠뜨리는 순간 남의 이벤트가 열린다. @RequireApprovedPartner() 는 "승인된 파트너인가"만 보지
 * "이 행이 그 파트너 것인가"는 보지 않는다 — 둘 다 필요하다.
 */
export function requirePartnerProfileId(user: AuthenticatedUser): string {
  if (!user.partnerProfileId) {
    throw new ForbiddenException('파트너 신청서를 먼저 제출해 주세요.');
  }

  return user.partnerProfileId;
}

/**
 * If-Match 헤더에서 낙관적 락 토큰을 꺼낸다. 이 값은 `Event.version` 이다. (IC-63)
 *
 * 헤더가 없으면 428 이다 — 400 이 아닌 이유는 "요청이 틀렸다"가 아니라
 * "전제 조건을 먼저 걸어라"이기 때문이고, 클라이언트는 재조회해서 version 을 실어 다시 보내면 된다.
 * 헤더를 옵션으로 두면 그걸 안 보내는 클라이언트가 하나 생기는 순간 동시 편집이 조용히 덮어쓰기가 된다.
 * (Nest 에 428 전용 예외 클래스가 없어 HttpException 을 직접 만든다.)
 */
const HTTP_PRECONDITION_REQUIRED = 428;

export function parseIfMatchVersion(raw: string | undefined): number {
  const cleaned = raw?.trim().replace(/^W\//, '').replace(/^"|"$/g, '');
  const version = Number(cleaned);

  if (!cleaned || !Number.isInteger(version) || version < 0) {
    throw new HttpException(
      {
        code: 'IF_MATCH_REQUIRED',
        hint: 'If-Match 헤더에 조회 시 받은 version 값을 넣어 주세요.',
      },
      HTTP_PRECONDITION_REQUIRED,
    );
  }

  return version;
}

/** EventImage.id 를 서버가 먼저 정한다 — blob 경로에 박아 DB 행과 파일을 1:1 로 묶기 위해서다. */
export function newImageId(): string {
  return randomUUID();
}

const MAX_SLUG_LENGTH = 80;
const SUFFIX_LENGTH = 6;

/**
 * 이벤트 슬러그.
 *
 * `event_slug_uq` 는 `WHERE "deletedAt" IS NULL` 부분 유니크라 소프트 삭제된 이벤트가
 * 슬러그를 영구 점유하지는 않지만 **살아 있는 행끼리는 여전히 충돌한다**.
 * '주말 디너 코스' 같은 제목은 전국에서 겹치므로 항상 짧은 무작위 꼬리를 붙인다 —
 * 충돌하면 재시도하는 루프보다 충돌 자체를 없애는 쪽이 싸다.
 *
 * 한글을 로마자로 바꾸지 않는다: 국어의 로마자 표기법은 예외가 많아 서버가 임의로 정하면
 * 파트너가 기대한 주소와 달라진다. Next.js 는 유니코드 경로를 그대로 처리한다.
 */
export function buildEventSlug(title: string, explicit?: string): string {
  const base = slugify(explicit ?? title) || 'event';
  const head = base.slice(0, MAX_SLUG_LENGTH - SUFFIX_LENGTH - 1);

  return `${head}-${randomBytes(4).toString('hex').slice(0, SUFFIX_LENGTH)}`;
}

function slugify(value: string): string {
  return value
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
