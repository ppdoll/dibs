import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDefined, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * 설정 값 쓰기. (IC-65)
 *
 * `value` 를 타입 없이 받는 이유: Setting.valueJson 은 불리언 플래그부터 숫자·문자열까지
 * 담는 범용 저장소다. 대신 서비스가 **키별 스키마**로 한 번 더 검증한다 —
 * 여기서 any 를 통과시키고 저장소 직전에 좁히는 편이, 키가 늘 때마다 DTO 를 늘리는 것보다
 * 잘못된 값이 들어갈 창을 좁게 만든다.
 */
export class UpsertSettingDto {
  @ApiProperty({
    description: '설정 값. 피처 플래그 키는 boolean 이어야 한다(서비스가 키별로 검증한다).',
  })
  @IsDefined()
  value!: unknown;

  @ApiPropertyOptional({ maxLength: 500, description: '이 키가 무엇인지. 콘솔 목록에 보인다.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ maxLength: 500, description: '왜 바꾸는지. 감사 로그 reasonMemo 로 남는다.' })
  @IsString()
  @MaxLength(500)
  reason!: string;
}
