import { OmitType, PartialType } from '@nestjs/swagger';

import { CreateEventDto } from './create-event.dto';

/**
 * 이벤트 부분 수정. `If-Match: <Event.version>` 이 필수다. (IC-63)
 *
 * venueId 와 mode 를 뺀 이유:
 *  - `mode` 는 Application 이 (eventId, eventMode) 복합 FK 로 물고 있다. 바꾸면 이미 달린 신청이
 *    "INSTANT 이벤트에 달린 BID 신청"이 되어 FK 위반으로 죽거나, 더 나쁘게는 스위퍼의
 *    자리 반환 분기가 통째로 잘못 돈다. 모드는 다시 만들어야 하는 값이다.
 *  - `venueId` 는 sigunguCode·주소·영업시간이 전부 딸려오는 값이라 "수정"이 아니라 다른 이벤트다.
 *    옮기고 싶으면 시설 쪽에서 처리한다.
 *
 * 나머지 필드도 상태에 따라 잠긴다 — 금액 규칙(IC-64)과 예약금 윈도우 축소(IC-26)는
 * EventUpdateService 가 거절한다. DTO 는 "무엇을 보낼 수 있는가"만 정하고
 * "지금 바꿔도 되는가"는 서비스가 정한다.
 */
export class UpdateEventDto extends PartialType(
  OmitType(CreateEventDto, ['venueId', 'mode'] as const),
) {}
