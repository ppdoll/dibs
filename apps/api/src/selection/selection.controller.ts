import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiPreconditionFailedResponse,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireApprovedPartner, Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import {
  AutoPreselectDto,
  FinalizeSelectionDto,
  LiveApplicantPageDto,
  LiveApplicantQueryDto,
  PartnerSelectionRoundDto,
  PromoteEntryDto,
  SelectionEntryQueryDto,
  SelectionOverrideDto,
} from './dto/selection.dto';
import { RankingService } from './ranking.service';
import { SelectionFinalizeService } from './selection-finalize.service';
import { SelectionService } from './selection.service';
import { parseIfMatchVersion } from './internal/selection-context';

/**
 * 파트너의 최종 명단 화면.
 *
 * ★ 이 컨트롤러의 응답에는 금액·순위·커트라인이 전부 들어 있다. D-07 이 감추는 상대는 이용자이고
 * 파트너는 자기 이벤트를 전부 본다. 그래서 클래스 전체에 `@Roles(PARTNER)` + `@RequireApprovedPartner()`
 * 를 걸고, 그 위에 모든 쿼리가 `partnerId` 술어로 한 번 더 좁힌다 — 데코레이터는 "승인된 파트너인가"만
 * 보지 "이 라운드가 그 파트너 것인가"는 보지 않는다. 둘 다 필요하다.
 *
 * 상태를 바꾸는 엔드포인트는 전부 If-Match(`Selection.version`)를 요구한다. 명단 심사는 파트너가
 * 화면을 오래 열어두고 여러 번 누르는 작업이라, 토큰이 없으면 두 탭의 조작이 조용히 서로를 덮어쓴다.
 */
@ApiTags('partner-selections')
@ApiBearerAuth()
@Roles(UserRole.PARTNER)
@RequireApprovedPartner()
@Controller('partner/selections')
export class SelectionController {
  constructor(
    private readonly selection: SelectionService,
    private readonly ranking: RankingService,
    private readonly finalize: SelectionFinalizeService,
  ) {}

  @Get('by-event/:eventId')
  @ApiOperation({
    summary: '이벤트의 최신 선정 라운드 (커트라인 포함)',
    description: '예약금 마감이 지나 순위가 확정된 뒤에만 존재한다. 그 전에는 404다.',
  })
  @ApiOkResponse({ type: PartnerSelectionRoundDto })
  getByEvent(@CurrentUser() user: AuthenticatedUser, @Param('eventId') eventId: string) {
    return this.selection.getLatestRoundByEvent(user, eventId);
  }

  @Get('by-event/:eventId/live-applicants')
  @ApiOperation({
    summary: '진행 중 신청자 목록 (금액 + 잠정 순위)',
    description:
      '라운드가 열리기 전에도 "누가 얼마에 신청했는지"를 볼 수 있는 경로다. 얼린 스냅샷이 아니라 ' +
      '살아 있는 Application 을 읽으므로 응답은 조회 시점의 사진이다. ' +
      '★ provisionalPosition 은 **잠정 순위**다 — 상향 입찰(D-06)과 예약금 만료(D-05)로 마감까지 ' +
      '계속 바뀌고, 확정 순위는 예약금 마감(rankingLockAt) 이후 SelectionEntry.rankNo 다. ' +
      '예약금 미납(PENDING_DEPOSIT) 신청은 순위 없이 목록 뒤에 붙고 요약에서 따로 세어 준다.',
  })
  @ApiOkResponse({ type: LiveApplicantPageDto })
  listLiveApplicants(
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId') eventId: string,
    @Query() query: LiveApplicantQueryDto,
  ) {
    return this.selection.listLiveApplicants(user, eventId, query);
  }

  @Post('by-event/:eventId/open')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: '선정 라운드 열기 (순위 확정)',
    description:
      '보통은 크론이 자동으로 연다. 1라운드 확정 후 결원이 생겨 보충 라운드를 열 때 쓴다. ' +
      '예약금 마감(rankingLockAt)이 지나야 하고 열린 홀드가 하나도 없어야 한다.',
  })
  @ApiConflictResponse({ description: '아직 확정 시각 전이거나, 심사 중인 라운드가 남아 있다.' })
  openRound(@CurrentUser() user: AuthenticatedUser, @Param('eventId') eventId: string) {
    return this.ranking.openRoundManually(user, eventId);
  }

  @Get(':selectionId')
  @ApiOperation({ summary: '라운드 상세 (커트라인 포함)' })
  @ApiOkResponse({ type: PartnerSelectionRoundDto })
  getRound(@CurrentUser() user: AuthenticatedUser, @Param('selectionId') selectionId: string) {
    return this.selection.getRound(user, selectionId);
  }

  @Get(':selectionId/entries')
  @ApiOperation({
    summary: '순위순 신청자 목록 (금액 포함)',
    description: '제외된 후보는 rankNo가 null이고 목록 맨 뒤에 온다.',
  })
  listEntries(
    @CurrentUser() user: AuthenticatedUser,
    @Param('selectionId') selectionId: string,
    @Query() query: SelectionEntryQueryDto,
  ) {
    return this.selection.listEntries(user, selectionId, query);
  }

  @Get(':selectionId/export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="dibs-selection.csv"')
  @ApiProduces('text/csv')
  @ApiOperation({
    summary: '명단 CSV 내려받기',
    description: '엑셀에서 한글이 깨지지 않도록 BOM과 CRLF를 붙인다.',
  })
  exportCsv(@CurrentUser() user: AuthenticatedUser, @Param('selectionId') selectionId: string) {
    return this.selection.exportCsv(user, selectionId);
  }

  @Post(':selectionId/auto-preselect')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '상위 N명 자동 예비선정',
    description: 'topN을 생략하면 남은 정원만큼 뽑는다. 이미 예비선정된 후보는 그대로 둔다.',
  })
  @ApiHeader({ name: 'If-Match', required: true, description: '조회로 받은 Selection.version' })
  @ApiPreconditionFailedResponse({ description: 'version이 낡았다. 재조회 후 다시 시도.' })
  autoPreselect(
    @CurrentUser() user: AuthenticatedUser,
    @Param('selectionId') selectionId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() dto: AutoPreselectDto,
  ) {
    return this.selection.autoPreselect(user, selectionId, parseIfMatchVersion(ifMatch), dto);
  }

  @Post(':selectionId/entries/:entryId/add')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '수동 추가 (순위 밖 후보를 명단에)',
    description: '정원 + 허용 초과치를 넘으면 409다. 라운드 설정에 따라 사유가 필수다.',
  })
  @ApiHeader({ name: 'If-Match', required: true })
  addEntry(
    @CurrentUser() user: AuthenticatedUser,
    @Param('selectionId') selectionId: string,
    @Param('entryId') entryId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() dto: SelectionOverrideDto,
  ) {
    return this.selection.addEntry(user, selectionId, entryId, parseIfMatchVersion(ifMatch), dto);
  }

  @Post(':selectionId/entries/:entryId/remove')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '수동 제외',
    description: '확정 전이면 NOT_SELECTED, 확정 후면 REVOKED로 남아 취소 주체와 사유가 기록된다.',
  })
  @ApiHeader({ name: 'If-Match', required: true })
  removeEntry(
    @CurrentUser() user: AuthenticatedUser,
    @Param('selectionId') selectionId: string,
    @Param('entryId') entryId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() dto: SelectionOverrideDto,
  ) {
    return this.selection.removeEntry(user, selectionId, entryId, parseIfMatchVersion(ifMatch), dto);
  }

  @Post(':selectionId/entries/:entryId/promote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '결원 승계',
    description: 'fromEntryId가 실제로 빠져 있어야 한다(REVOKED/NOT_SELECTED). 승계 링크가 함께 남는다.',
  })
  @ApiHeader({ name: 'If-Match', required: true })
  promoteEntry(
    @CurrentUser() user: AuthenticatedUser,
    @Param('selectionId') selectionId: string,
    @Param('entryId') entryId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() dto: PromoteEntryDto,
  ) {
    return this.selection.promoteEntry(user, selectionId, entryId, parseIfMatchVersion(ifMatch), dto);
  }

  @Post(':selectionId/finalize')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '명단 확정 (되돌릴 수 없음)',
    description:
      '예비선정 → 선정, 나머지 → 비선정으로 닫고 신청 상태까지 종결한다. ' +
      '비선정자 예약금은 환불 큐에 오르고 전원에게 결과 알림이 나간다.',
  })
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiPreconditionFailedResponse({ description: 'version이 낡았다. 재조회 후 다시 시도.' })
  finalizeRound(
    @CurrentUser() user: AuthenticatedUser,
    @Param('selectionId') selectionId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() dto: FinalizeSelectionDto,
  ) {
    return this.finalize.finalize(user, selectionId, parseIfMatchVersion(ifMatch), dto);
  }
}
