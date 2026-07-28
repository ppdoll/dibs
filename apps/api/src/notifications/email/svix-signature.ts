import { createHmac, timingSafeEqual } from 'node:crypto';

import { WEBHOOK_TOLERANCE_SECONDS } from '../notification-policy';

/**
 * Resend(= Svix) 웹훅 서명 검증.
 *
 * Svix 라이브러리를 의존성에 추가하지 않고 직접 구현한 이유는 하나다 — 검증 규칙이
 * HMAC-SHA256 세 줄이고, 이 경로가 **인증 없이 열린 유일한 쓰기 엔드포인트**라
 * 무엇을 검사하고 무엇을 안 검사하는지가 코드에 그대로 보여야 하기 때문이다.
 *
 * 서명 대상 문자열은 `{svix-id}.{svix-timestamp}.{raw body}` 이고 **원문 바이트**여야 한다.
 * JSON 을 파싱했다가 다시 문자열로 만들면 키 순서·공백·유니코드 이스케이프가 달라져
 * 서명이 깨진다. 그래서 rawBody 가 없으면 검증 자체를 실패시킨다 — "검증을 건너뛰고 통과"는
 * 이 엔드포인트에서 곧 누구나 배달 상태를 조작할 수 있다는 뜻이다.
 */
export interface SvixHeaders {
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
}

export type SignatureResult = { ok: true } | { ok: false; reason: string };

export function verifySvixSignature(
  secret: string,
  headers: SvixHeaders,
  rawBody: string,
  now: Date,
): SignatureResult {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return { ok: false, reason: 'MISSING_SIGNATURE_HEADERS' };

  const sentAtSeconds = Number(timestamp);
  if (!Number.isFinite(sentAtSeconds)) return { ok: false, reason: 'INVALID_TIMESTAMP' };

  // 재생 공격 방어의 1차 방어선. 서명은 영구히 유효하므로 시각 창이 없으면
  // 한 번 새어 나간 요청을 몇 달 뒤에도 그대로 다시 던질 수 있다.
  const driftSeconds = Math.abs(now.getTime() / 1000 - sentAtSeconds);
  if (driftSeconds > WEBHOOK_TOLERANCE_SECONDS) return { ok: false, reason: 'TIMESTAMP_OUT_OF_RANGE' };

  // `whsec_` 접두사를 뗀 나머지가 base64 로 인코딩된 비밀키다.
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest('base64');

  // 헤더에는 서명이 여러 개 올 수 있다(키 로테이션 중). 하나라도 맞으면 통과다.
  const candidates = signature
    .split(' ')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('v1,'))
    .map((part) => part.slice('v1,'.length));

  if (candidates.length === 0) return { ok: false, reason: 'NO_V1_SIGNATURE' };

  // some() 으로 조기 반환하지 않는다 — 몇 번째에서 맞았는지가 타이밍으로 새지 않게 전부 돈다.
  let matched = false;
  for (const candidate of candidates) {
    if (safeEqual(candidate, expected)) matched = true;
  }

  return matched ? { ok: true } : { ok: false, reason: 'SIGNATURE_MISMATCH' };
}

/** 길이 노출과 조기 반환을 피하기 위한 상수 시간 비교. (CronGuard 와 같은 방식) */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');

  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufB, bufB);
    return false;
  }

  return timingSafeEqual(bufA, bufB);
}
