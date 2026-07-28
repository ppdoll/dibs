/**
 * 이용자 화면에서만 쓰는 응답 타입.
 *
 * `src/types/api.ts` 는 공용이라 여러 담당이 동시에 만지고 있다. 여기 있는 것들은
 * 신청 계열 **변경 요청의 응답**뿐이고 이 폴더 밖에서 쓸 일이 없어서 따로 뒀다.
 * 모양은 apps/api 의 서비스가 실제로 만들어 반환하는 객체에서 그대로 옮겼다.
 *
 * ★ D-07 — 여기에도 `rank` / `cutoff` / 남의 `amount` 는 없다. 서버가 안 보내고,
 *   타입에 자리를 만들어 두면 언젠가 그리는 화면이 생긴다.
 */

import type { ApplicationStatus, DepositStatus } from '@/types/api';

/** POST /api/applications 응답 */
export interface ApplyResult {
  id: string;
  eventId: string;
  status: ApplicationStatus;
  /** 내가 적어낸 금액 (INSTANT 는 서버가 고정 금액을 채운다) */
  myAmount: number;
  slotHeld: boolean;
  version: number;
  deposit: {
    status: DepositStatus;
    dueAt: string | null;
    requiredAmount: number;
  };
  /** 소프트 클로즈로 마감이 밀렸으면 새 마감시각 (D-08) */
  deadlineExtendedTo: string | null;
}

/** POST /api/applications/:id/raise 응답 (D-06) */
export interface RaiseResult {
  id: string;
  eventId: string;
  status: ApplicationStatus;
  myAmount: number;
  version: number;
  deposit: {
    status: DepositStatus;
    dueAt: string | null;
    requiredAmount: number;
  };
  /** 차액을 기한 내에 못 내면 되돌아갈 금액. 내 금액이라 내게는 공개다. */
  rollbackTo: number | null;
  deadlineExtendedTo: string | null;
}

/** POST /api/applications/:id/cancel 응답 */
export interface CancelResult {
  id: string;
  eventId: string;
  status: ApplicationStatus;
  canceledAt: string;
}

/** POST /api/applications/:id/deposit/confirm 응답 */
export interface DepositConfirmResult {
  id: string;
  eventId: string;
  status: ApplicationStatus;
  myAmount: number;
  version: number;
  deposit: {
    status: DepositStatus;
    dueAt: string | null;
    requiredAmount: number;
    paidAmount: number;
  };
}

/** POST /api/applications/:id/reapply 응답 — 신청과 같은 모양이다. */
export type ReapplyResult = ApplyResult;
