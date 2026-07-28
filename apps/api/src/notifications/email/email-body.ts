import { NotificationCategory } from '@prisma/client';

/**
 * 메일 본문 조립.
 *
 * 템플릿 엔진을 두지 않는다. 알림 문구는 이미
 * `templates/notification-templates.ts` 한 곳에서 만들어져 DB(EmailDelivery.bodyText)에
 * 굳어 있고, 여기서 하는 일은 그 텍스트를 HTML 로 감싸는 것뿐이다.
 * 문구를 두 벌(텍스트용/HTML용)로 두면 D-07 검증을 통과한 쪽과 실제로 나가는 쪽이 갈린다.
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/**
 * 광고성 정보는 제목 맨 앞에 `(광고)` 를 붙여야 한다 — 정보통신망법 제50조 제4항.
 * 이걸 발송 직전(디스패처)에서 붙이는 이유: 범주는 알림을 만든 도메인 모듈이 정하고,
 * 제목은 그보다 앞서 저장되므로 저장 시점에는 "이게 광고인가"가 아직 확정이 아니다.
 */
export function applyAdPrefix(subject: string, category: NotificationCategory): string {
  if (category !== NotificationCategory.MARKETING) return subject;
  if (subject.startsWith('(광고)')) return subject;
  return `(광고) ${subject}`;
}

export interface EmailBodyInput {
  titleKo: string;
  bodyKo: string;
  /** Next.js 내부 상대경로. 절대 URL 은 오지 않는다(safeDeepLink 가 이미 걸렀다). */
  deepLinkPath: string | null;
  webAppUrl: string;
  /** 광고성 메일에는 수신거부 안내가 법적으로 필요하다. */
  includeUnsubscribe: boolean;
}

/**
 * 텍스트 본문. HTML 을 못 읽는 클라이언트와 스팸 필터가 함께 본다.
 * HTML 만 보내면 스팸 점수가 올라간다.
 */
export function renderEmailText(input: EmailBodyInput): string {
  const base = input.webAppUrl.replace(/\/$/, '');
  const lines = [input.titleKo, '', input.bodyKo];

  if (input.deepLinkPath) {
    lines.push('', `바로가기: ${base}${input.deepLinkPath}`);
  }

  lines.push('', '— Dibs');

  if (input.includeUnsubscribe) {
    lines.push(`수신거부: ${base}/my/notifications/preferences`);
  }

  return lines.join('\n');
}

export function renderEmailHtml(input: EmailBodyInput): string {
  const base = input.webAppUrl.replace(/\/$/, '');
  const title = escapeHtml(input.titleKo);
  // 줄바꿈만 살린다. 사용자·파트너가 쓴 글이 그대로 들어오므로 태그는 전부 이스케이프한다.
  const body = escapeHtml(input.bodyKo).replace(/\n/g, '<br />');

  const cta = input.deepLinkPath
    ? `<p style="margin:24px 0 0"><a href="${escapeHtml(base + input.deepLinkPath)}"
         style="display:inline-block;padding:12px 20px;background:#111;color:#fff;
                border-radius:8px;text-decoration:none;font-weight:600">확인하러 가기</a></p>`
    : '';

  const unsubscribe = input.includeUnsubscribe
    ? `<p style="margin:8px 0 0;color:#888;font-size:12px">
         광고성 정보 수신을 원하지 않으시면
         <a href="${escapeHtml(base)}/my/notifications/preferences" style="color:#888">수신거부</a>
         에서 설정을 변경하실 수 있습니다.
       </p>`
    : '';

  return `<!doctype html>
<html lang="ko"><body style="margin:0;padding:24px;background:#f6f6f7;
  font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
    <h1 style="margin:0 0 16px;font-size:18px;line-height:1.4;color:#111">${title}</h1>
    <div style="font-size:15px;line-height:1.7;color:#333">${body}</div>
    ${cta}
    <hr style="margin:32px 0 16px;border:0;border-top:1px solid #eee" />
    <p style="margin:0;color:#888;font-size:12px">Dibs — 먼저 찜하는 예약 플랫폼</p>
    ${unsubscribe}
  </div>
</body></html>`;
}
