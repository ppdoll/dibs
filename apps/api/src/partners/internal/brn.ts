/**
 * 사업자등록번호(10자리) 정규화·검증.
 *
 * 부분 유니크(`business_brn_uq`)는 **하이픈이 제거된 10자리**를 전제로 걸려 있다.
 * '123-45-67890' 과 '1234567890' 이 둘 다 저장되면 같은 사업자가 두 행이 되고,
 * 유니크 인덱스는 그걸 다른 값으로 본다 — 즉 중복 등록 차단이 통째로 무력해진다.
 */

/** 하이픈·공백을 걷어낸다. 형식 검증은 DTO 가 이미 했다고 보지 않는다. */
export function normalizeBrn(raw: string): string {
  return raw.replace(/[^0-9]/g, '');
}

/**
 * 국세청 사업자등록번호 체크섬.
 *
 * 형식만 보면 '0000000000' 같은 값도 통과한다. 사업자 확인은 심사(운영자)가 하지만,
 * 명백히 불가능한 번호는 신청 단계에서 거른다 — 심사 큐가 오탈자로 차는 걸 막는 게 목적이다.
 */
export function isValidBrn(digits: string): boolean {
  if (!/^\d{10}$/.test(digits)) return false;

  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  const n = digits.split('').map(Number) as number[];

  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    sum += (n[i] as number) * (weights[i] as number);
  }
  // 9번째 자리는 가중치 5를 곱한 값의 10의 자리를 한 번 더 더한다.
  sum += Math.floor(((n[8] as number) * 5) / 10);

  return (10 - (sum % 10)) % 10 === n[9];
}
