import { NotificationCategory, NotificationType } from '@prisma/client';

import { isMandatoryCategory } from '../notification-policy';
import { NOTIFICATION_TEMPLATES, renderNotification, safeDeepLink } from './notification-templates';

/**
 * 이 파일이 지키는 것은 문구의 예쁨이 아니라 D-07이다.
 * 커트라인·타인 금액·본인 순위가 알림 payload로 새는 순간 밀봉입찰이 공개입찰이 되고,
 * 그건 되돌릴 수 없다. 그래서 "샜을 때 터진다"를 테스트로 고정한다.
 */
describe('notification templates — D-07 / IC-44', () => {
  it('커트라인이 섞인 payload는 렌더링 자체가 실패한다', () => {
    expect(() =>
      renderNotification(NotificationType.SELECTION_FINALIZED_NOT_SELECTED, {
        eventTitle: '금요일 저녁 오마카세',
        applicationId: 'clx0000000000000000000001',
        // "8만원에 밀리셨습니다" 를 만들려던 시도. 이 한 줄이 그 이벤트의 커트라인 공개다.
        cutoffAmount: 80_000,
      } as never),
    ).toThrow(/D-07 위반/);
  });

  it('본인 순위도 새면 안 된다 — 자기 순위조차 비공개다', () => {
    expect(() =>
      renderNotification(NotificationType.SELECTION_FINALIZED_SELECTED, {
        eventTitle: '금요일 저녁 오마카세',
        applicationId: 'clx0000000000000000000001',
        myRank: 3,
      } as never),
    ).toThrow(/D-07 위반/);
  });

  it('본인 예약금 금액은 허용 키로 선언돼 있어 통과한다', () => {
    const rendered = renderNotification(NotificationType.DEPOSIT_REQUIRED, {
      eventTitle: '금요일 저녁 오마카세',
      applicationId: 'clx0000000000000000000001',
      myDepositAmount: 20_000,
      depositDueAtIso: '2026-07-27T12:00:00.000Z',
    });

    expect(rendered.titleKo).toContain('예약금');
    expect(rendered.bodyKo).toContain('20,000원');
    expect(rendered.deepLinkPath).toBe('/my/applications/clx0000000000000000000001/deposit');
  });

  it('스키마에 없는 필드는 발송 자체를 막는다', () => {
    expect(() =>
      renderNotification(NotificationType.EVENT_CLOSED_CAPACITY_REACHED, {
        eventTitle: '금요일 저녁 오마카세',
        eventId: 'clx0000000000000000000002',
        winnerList: ['홍길동'],
      } as never),
    ).toThrow(/IC-44/);
  });

  it('미선정 문구는 금액을 한 글자도 담지 않는다', () => {
    const rendered = renderNotification(NotificationType.SELECTION_FINALIZED_NOT_SELECTED, {
      eventTitle: '금요일 저녁 오마카세',
      applicationId: 'clx0000000000000000000001',
    });

    expect(rendered.bodyKo).not.toMatch(/원|커트라인|순위/);
  });

  it('모든 NotificationType에 템플릿이 있고, 필수 범주는 상수 맵에서만 파생된다', () => {
    for (const type of Object.values(NotificationType)) {
      expect(NOTIFICATION_TEMPLATES[type]).toBeDefined();
    }

    expect(isMandatoryCategory(NotificationCategory.DEPOSIT)).toBe(true);
    expect(isMandatoryCategory(NotificationCategory.RESULT)).toBe(true);
    expect(isMandatoryCategory(NotificationCategory.ACCOUNT)).toBe(true);
    expect(isMandatoryCategory(NotificationCategory.MARKETING)).toBe(false);
  });

  it('딥링크는 외부로 나갈 수 없다 — 스킴 없는 절대 URL 차단', () => {
    expect(safeDeepLink('//evil.example')).toBeNull();
    expect(safeDeepLink('https://evil.example')).toBeNull();
    expect(safeDeepLink('/events/abc')).toBe('/events/abc');
  });
});
