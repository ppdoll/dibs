import { ConflictException, PreconditionFailedException } from '@nestjs/common';

/**
 * 조건부 UPDATE의 영향 행 수를 단언한다. (IC-01)
 *
 * 0행은 "행이 없다"가 아니라 **그 사이에 전제가 깨졌다**는 뜻이다.
 * 읽고 → 검사하고 → 쓰는 코드는 서버리스 다중 인스턴스에서 두 문장 사이가
 * 통째로 경합 창이다. 그래서 상태 전제는 전부 WHERE 절에 넣고, 여기서는
 * 결과만 확인한다. `updateMany`의 count를 버리는 순간 모든 상태 전이가
 * read-then-write로 퇴화한다.
 *
 * 404가 아니라 409를 올리는 이유: 대상이 없어서가 아니라 상태가 바뀌어서
 * 실패한 것이므로, 클라이언트는 재조회 후 다시 판단해야 한다.
 */
export function assertAffected(count: number, expected: number, code: string): void {
  if (count !== expected) {
    throw new ConflictException({ code, expected, actual: count });
  }
}

/**
 * If-Match 가드용. 낙관적 락이 밀린 것은 "충돌"이 아니라 "전제 조건 실패"다. (IC-63)
 *
 * 409와 412를 구분하는 이유: 412는 클라이언트가 최신 version을 다시 받아
 * 그대로 재시도하면 풀리는 상황이고, 409는 상태 자체가 그 요청을 받을 수
 * 없게 바뀐 상황이다. 화면이 "새로고침 후 다시" / "이미 처리됨"을 다르게
 * 안내해야 하므로 코드로 구분해 둔다.
 */
export function assertVersionMatch(count: number, code: string): void {
  if (count !== 1) {
    throw new PreconditionFailedException({
      code,
      hint: 'If-Match 값이 낡았습니다. 다시 조회해 주세요.',
    });
  }
}
