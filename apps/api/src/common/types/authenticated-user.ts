import type { UserRole } from '@prisma/client';

/**
 * JWT에서 복원한 요청 주체.
 *
 * 여기 담는 값은 **토큰 발급 시점의 스냅샷**이다. 권한이 바뀌면 토큰이
 * 낡으므로, 정지·역할 변경 같은 즉시 반영이 필요한 변화는 tokenVersion을
 * 올려 기존 토큰을 무효화한다. (JwtStrategy가 매 요청 DB와 대조한다)
 */
export interface AuthenticatedUser {
  id: string;
  email: string | null;
  displayName: string;
  roles: UserRole[];
  /**
   * 파트너로 **실제 활동 가능한지**. 파트너 역할이 있어도 운영자 승인 전이면
   * false다. 역할과 승인은 별개다. (D-09)
   */
  partnerApproved: boolean;
  partnerProfileId: string | null;
}

/** JWT 페이로드. 최소한만 담는다 — 토큰은 로그에 남기 쉽다. */
export interface JwtPayload {
  sub: string;
  /** tokenVersion. DB 값과 다르면 거부한다. */
  tv: number;
}
