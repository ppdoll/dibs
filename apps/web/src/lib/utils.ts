import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 1234567 → "1,234,567원"
 *
 * @deprecated 화면에서는 `lib/format.ts` 의 `formatWon` 을 쓴다.
 * null/NaN 처리와 축약("8만원")까지 그쪽에 모여 있다. 이 함수는 스캐폴드
 * 시절부터 있던 것이라 남겨 두지만, 새 코드에서 쓰지 말 것.
 */
export function formatKrw(amount: number): string {
  return `${amount.toLocaleString('ko-KR')}원`;
}
