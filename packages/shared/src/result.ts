/**
 * 도메인 검증 결과.
 *
 * 예외 대신 값으로 돌려주는 이유: 같은 규칙을 서버(NestJS)와 화면(Next.js)이
 * 함께 쓴다. 화면에서는 필드별로 빨간 글씨를 띄워야 하므로 어느 필드가
 * 왜 틀렸는지가 필요하고, 예외 하나로는 여러 개를 한꺼번에 전달할 수 없다.
 */

export interface ValidationIssue {
  /** 기계가 분기할 안정적인 코드. 문구가 바뀌어도 이건 유지한다. */
  code: string;
  /** 사람이 읽을 한국어 문구. 그대로 화면에 띄울 수 있어야 한다. */
  message: string;
  /** 어느 입력이 문제인지. 폼 필드명과 맞춘다. */
  field?: string;
}

export type ValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

export const valid = (): ValidationResult => ({ ok: true });

export const invalid = (...issues: ValidationIssue[]): ValidationResult => ({
  ok: false,
  issues,
});

/** 여러 검증을 합친다. 하나라도 실패하면 실패이고, 이유는 전부 모은다. */
export function combine(...results: readonly ValidationResult[]): ValidationResult {
  const issues = results.flatMap((r) => (r.ok ? [] : r.issues));
  return issues.length === 0 ? valid() : { ok: false, issues };
}

/** 검증 결과를 던지고 싶을 때. 서버 경계에서만 쓴다. */
export class DomainValidationError extends Error {
  constructor(readonly issues: readonly ValidationIssue[]) {
    super(issues.map((i) => i.message).join(' / '));
    this.name = 'DomainValidationError';
  }
}

export function orThrow(result: ValidationResult): void {
  if (!result.ok) throw new DomainValidationError(result.issues);
}
