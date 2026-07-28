import { AuditTargetType } from '@prisma/client';

import type { AuthenticatedUser } from '../common/types/authenticated-user';

/**
 * IC-01 의 단언은 공통 파일이 정본이다. 여기서 다시 구현하지 않고 통과시킨다 —
 * 두 벌이 있으면 한쪽만 409/412 구분(assertVersionMatch)을 갖게 되는 날이 온다.
 */
export { assertAffected, assertVersionMatch } from '../common/db/assert-affected';

/**
 * 감사 체인 샤드 키. (IC-61 ★)
 *
 * 이벤트에 매달린 것들은 전부 `event:{eventId}` 한 체인으로 모은다. 그래야
 * finalize 트랜잭션이 자기 이벤트하고만 경합하고, 파트너 승인이나 설정 변경 같은
 * 무관한 쓰기가 그 뒤에 줄 서지 않는다. 나머지는 targetType 단위로 샤딩한다.
 */
export function auditChainKey(targetType: AuditTargetType, eventId?: string | null): string {
  return eventId ? `event:${eventId}` : targetType;
}

/**
 * 감사 로그에 남길 행위자 표기. AuditLog.actorLabel 은 VarChar(120)이고
 * append-only 라 지워지지도 않으므로 길이를 여기서 자른다.
 */
export function actorLabel(admin: AuthenticatedUser): string {
  const label = admin.email ? `${admin.displayName} <${admin.email}>` : admin.displayName;
  return label.slice(0, 120);
}

/**
 * jsonb 파라미터. Prisma 태그드 템플릿은 JS 객체를 jsonb 로 바인딩하지 못하므로
 * 문자열로 넘기고 SQL 쪽에서 `::jsonb` 로 캐스팅한다.
 */
export function toJsonParam(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

/**
 * BigInt 는 JSON.stringify 에서 그대로 터진다. AuditLog.seq / Application.applySeq 를
 * 응답에 실을 때는 반드시 문자열로 바꾼다.
 */
export function seqToString(seq: bigint): string {
  return seq.toString();
}

/** 목록 조회의 상한. 운영자라도 한 번에 테이블을 통째로 끌고 오지는 못하게 한다. */
export const ADMIN_MAX_PAGE_SIZE = 100;
