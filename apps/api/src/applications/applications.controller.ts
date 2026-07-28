import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { ApplicationApplyService } from './application-apply.service';
import { ApplicationBiddingService } from './application-bidding.service';
import { ApplicationDepositsService } from './application-deposits.service';
import { MyApplicationsService } from './my-applications.service';
import {
  requireIdempotencyKey,
  type RequestContext,
} from './internal/application-context';
import {
  CancelApplicationDto,
  ConfirmDepositDto,
  CreateApplicationDto,
  MyApplicationListQueryDto,
  RaiseBidDto,
  ReapplyDto,
} from './dto/application.dto';

const IDEMPOTENCY_HEADER = {
  name: 'Idempotency-Key',
  required: true,
  description:
    '클라이언트가 만든 요청 고유값(최대 64자). 같은 키로 다시 보내면 처음 응답을 그대로 재생한다.',
} as const;

/**
 * 이용자의 신청·입찰·예약금.
 *
 * 전역 JwtAuthGuard 때문에 모든 엔드포인트가 기본 인증이다. @Roles 를 걸지 않은 이유는
 * 신청은 모든 이용자의 기본 기능이기 때문이고, "그 신청이 내 것인가"는 데코레이터가 아니라
 * **모든 쿼리의 `userId` 술어**가 지킨다 — 새 핸들러에서 그 술어를 빠뜨리는 순간 남의 신청이 열린다.
 *
 * 상태를 바꾸는 엔드포인트는 전부 `Idempotency-Key` 를 요구한다(IC-03).
 */
@ApiTags('applications')
@ApiBearerAuth()
@Controller('applications')
export class ApplicationsController {
  constructor(
    private readonly apply: ApplicationApplyService,
    private readonly bidding: ApplicationBiddingService,
    private readonly deposits: ApplicationDepositsService,
    private readonly mine: MyApplicationsService,
  ) {}

  @Post()
  @ApiOperation({
    summary: '신청',
    description:
      'INSTANT 는 신청 즉시 자리를 잡고 당락이 정해진다. BID 는 정원과 무관하게 접수되고 마감 후 순위로 정해진다(D-02/D-03). 예약금이 필요한 이벤트면 응답의 deposit.dueAt 까지 입금해야 신청이 유효해진다(D-05).',
  })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiCreatedResponse({ description: '접수된 신청. 순위·커트라인은 어떤 경우에도 포함되지 않는다.' })
  @ApiForbiddenResponse({ description: '휴대폰 인증이 필요하거나 이용할 수 없는 계정이다.' })
  @ApiConflictResponse({ description: '신청 기간이 아니거나, 정원이 찼거나, 이미 신청했다.' })
  @ApiUnprocessableEntityResponse({ description: '같은 Idempotency-Key 로 다른 내용을 보냈다.' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateApplicationDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
  ) {
    return this.apply.apply(user, dto, context(idempotencyKey, ip));
  }

  @Get('me')
  @ApiOperation({
    summary: '내 신청 목록',
    description:
      '내가 적어낸 금액은 보이지만 내 순위는 보이지 않는다(D-07). 이벤트마다 경쟁률만 함께 온다.',
  })
  @ApiOkResponse({ description: '커서 페이지. nextCursor 를 다음 요청에 그대로 넣는다.' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: MyApplicationListQueryDto) {
    return this.mine.list(user, query);
  }

  @Get(':applicationId')
  @ApiOperation({
    summary: '내 신청 상세',
    description: '본인 입찰 이력과 열려 있는 예약금 홀드를 함께 준다. 순위·커트라인은 없다.',
  })
  get(@CurrentUser() user: AuthenticatedUser, @Param('applicationId') applicationId: string) {
    return this.mine.get(user, applicationId);
  }

  @Post(':applicationId/raise')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '재입찰 (금액 상향)',
    description:
      '올리는 것만 가능하다(D-06). 상향하면 그 시각이 새 타이브레이크 시계가 되므로 같은 금액대에서는 뒤로 밀린다. 정률 예약금이면 차액이 생기고, 기한 안에 안 내면 직전 완납 금액으로 되돌아간다.',
  })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiConflictResponse({ description: '내리는 금액이거나, 상향할 수 없는 상태이거나, 마감되었다.' })
  raise(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId') applicationId: string,
    @Body() dto: RaiseBidDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
  ) {
    return this.bidding.raise(user, applicationId, dto, context(idempotencyKey, ip));
  }

  @Post(':applicationId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '신청 취소',
    description:
      'INSTANT 는 잡아둔 자리를 반환한다. 취소 이력이 남고, 다시 신청하려면 10분을 기다려야 한다.',
  })
  @ApiHeader(IDEMPOTENCY_HEADER)
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId') applicationId: string,
    @Body() dto: CancelApplicationDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
  ) {
    return this.bidding.cancel(user, applicationId, dto, context(idempotencyKey, ip));
  }

  @Post(':applicationId/reapply')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '취소 후 재신청',
    description:
      '새 시각을 받는다 — 취소 전 순번은 돌려주지 않는다. 과거에 불렀던 최고 금액 이상이어야 하고, 10분에 한 번만 가능하다.',
  })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiTooManyRequestsResponse({ description: '재신청 쿨다운(10분)이 남았다.' })
  reapply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId') applicationId: string,
    @Body() dto: ReapplyDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
  ) {
    return this.apply.reapply(user, applicationId, dto, context(idempotencyKey, ip));
  }

  @Post(':applicationId/deposit/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '예약금 납부 확인',
    description:
      '열려 있는 홀드를 완납 처리하고 신청을 유효화한다. 실제 결제(PG) 집행은 후속 단계라 DEPOSIT_HOLD_ENABLED 가 켜져 있으면 501 로 거절한다(D-05).',
  })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiConflictResponse({ description: '열린 홀드가 없거나 입금 시간이 지났다.' })
  confirmDeposit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId') applicationId: string,
    @Body() dto: ConfirmDepositDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
  ) {
    return this.deposits.confirm(user, applicationId, dto, context(idempotencyKey, ip));
  }
}

function context(idempotencyKey: string | undefined, ip: string | undefined): RequestContext {
  return { idempotencyKey: requireIdempotencyKey(idempotencyKey), ip };
}
