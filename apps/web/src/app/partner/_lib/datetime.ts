/**
 * 폼의 날짜 입력과 서버의 ISO(UTC) 사이를 옮긴다.
 *
 * `<input type="datetime-local">` 은 **브라우저 로컬 시간대**의 벽시계 문자열을 준다.
 * 그 값을 `new Date(local)` 로 그냥 읽으면, 해외에 있는 담당자가 만든 이벤트의 마감이
 * 한국 이용자에게 9시간 어긋나 보인다. 우리 서비스의 시각은 예외 없이 KST 이므로
 * 입력값을 **KST 벽시계로 해석**하고, 표시할 때도 KST 벽시계로 되돌린다.
 *
 * 즉 파트너가 어디서 접속하든 "19:00 마감" 이라고 적으면 한국 시간 19시다.
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const pad2 = (n: number) => String(n).padStart(2, '0');

/** "2026-07-27T19:00" (KST 벽시계) → "2026-07-27T10:00:00.000Z" */
export function kstLocalToIso(local: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);

  if ([year, month, day, hour, minute].some((value) => !Number.isFinite(value))) return null;

  const utcMs = Date.UTC(year, month - 1, day, hour, minute) - KST_OFFSET_MS;
  const date = new Date(utcMs);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** ISO(UTC) → "2026-07-27T19:00" (KST 벽시계). datetime-local 의 value 로 쓴다. */
export function isoToKstLocal(iso: string | null | undefined): string {
  if (!iso) return '';

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const shifted = new Date(date.getTime() + KST_OFFSET_MS);
  return (
    `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}` +
    `T${pad2(shifted.getUTCHours())}:${pad2(shifted.getUTCMinutes())}`
  );
}

/** 지금부터 n시간 뒤를 KST 벽시계 문자열로. 폼 기본값용. */
export function kstLocalFromNow(hoursLater: number): string {
  return isoToKstLocal(new Date(Date.now() + hoursLater * 3_600_000).toISOString());
}
