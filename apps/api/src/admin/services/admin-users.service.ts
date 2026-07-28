import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AccountStatus,
  AuditAction,
  AuditTargetType,
  NotificationCategory,
  NotificationPriority,
  NotificationType,
  Prisma,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { toCursorPage } from '../../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { assertAffected, auditChainKey } from '../admin.internals';
import type {
  ChangeUserRolesDto,
  ReinstateUserDto,
  SuspendUserDto,
  UserSearchQueryDto,
} from '../dto/user-admin.dto';
import { AdminAuditService } from './admin-audit.service';
import { AdminOutboxService } from './admin-outbox.service';

const USER_SELECT = {
  id: true,
  email: true,
  displayName: true,
  roles: true,
  status: true,
  statusReason: true,
  suspendedUntil: true,
  phoneVerifiedAt: true,
  lastLoginAt: true,
  loginCount: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

/**
 * 계정 관리.
 *
 * ★ 정지는 반드시 `tokenVersion` 을 올린다. JwtStrategy 가 매 요청 status 를 다시 읽지만,
 * 그 검사 하나에만 의존하면 나중에 "DB 왕복을 줄이자"는 최적화 한 번으로 정지가 장식이 된다.
 * 버전을 올려두면 이미 발급된 토큰 자체가 무효라, 어떤 경로로 들어와도 통과하지 못한다.
 */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly outbox: AdminOutboxService,
  ) {}

  /**
   * 검색.
   *
   * 이메일·전화번호까지 부분일치로 훑는 화면이므로 결과에는 마스킹된 값만 담는다.
   * 원본이 필요한 순간은 상세 조회 하나뿐이고 그쪽은 PII_ACCESSED 로 감사된다.
   */
  async search(query: UserSearchQueryDto) {
    const rows = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        ...(query.status ? { status: query.status } : {}),
        ...(query.role ? { roles: { has: query.role } } : {}),
        ...(query.q
          ? {
              OR: [
                { email: { contains: query.q, mode: Prisma.QueryMode.insensitive } },
                { displayName: { contains: query.q, mode: Prisma.QueryMode.insensitive } },
                { phone: { contains: query.q.replace(/\D/g, '') } },
              ],
            }
          : {}),
      },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: USER_SELECT,
    });

    const page = toCursorPage(rows, query.limit);

    return { ...page, items: page.items.map((row) => ({ ...row, email: maskEmail(row.email) })) };
  }

  /** 상세. 원본 이메일·전화번호가 나가므로 열람 자체를 감사한다. */
  async getDetail(admin: AuthenticatedUser, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        ...USER_SELECT,
        phone: true,
        realName: true,
        notificationEmail: true,
        preferredRegionCode: true,
        withdrawalRequestedAt: true,
        anonymizedAt: true,
        partnerProfile: { select: { id: true, approvalStatus: true, contactName: true } },
        _count: { select: { applications: true, notifications: true } },
      },
    });

    if (!user) throw new NotFoundException('계정을 찾을 수 없습니다.');

    await this.prisma.$transaction(async (tx) => {
      await this.audit.lock(tx, auditChainKey(AuditTargetType.USER));
      await this.audit.append(tx, admin, {
        action: AuditAction.PII_ACCESSED,
        targetType: AuditTargetType.USER,
        targetId: userId,
        targetOwnerUserId: userId,
        summary: '계정 상세 열람(이메일·전화번호 포함)',
      });
    });

    return user;
  }

  /**
   * 정지.
   *
   * `suspendedUntil` 이 비면 무기한이다 — 자동 해제 스위퍼가 집어 가지 않으므로
   * 운영자가 손으로 풀어야 한다. 이게 기본값인 이유: 기한을 지레짐작해 넣으면
   * 심각한 위반도 조용히 풀린다.
   *
   * User 에는 Event 와 달리 `statusBeforeSuspend` 가 없다. 원래 상태는 감사 행의
   * beforeJson 에만 남고, 해제는 항상 ACTIVE 로 간다 — DORMANT 였던 계정을 DORMANT 로
   * 되돌려 봐야 다음 로그인에 어차피 ACTIVE 가 된다.
   */
  async suspend(admin: AuthenticatedUser, userId: string, dto: SuspendUserDto) {
    if (admin.id === userId) {
      // 자기 계정을 정지시키면 그 즉시 토큰이 죽어 해제할 수단이 사라진다.
      throw new BadRequestException('자기 계정은 정지할 수 없습니다.');
    }

    const correlationId = randomUUID();
    const until = dto.suspendedUntil ? new Date(dto.suspendedUntil) : null;

    if (until && until.getTime() <= Date.now()) {
      throw new BadRequestException('자동 해제 시각은 현재보다 뒤여야 합니다.');
    }

    return this.prisma.$transaction(async (tx) => {
      await this.audit.lock(tx, auditChainKey(AuditTargetType.USER));

      const before = await tx.user.findFirst({
        where: { id: userId, deletedAt: null },
        select: { id: true, status: true, displayName: true, roles: true },
      });

      if (!before) throw new NotFoundException('계정을 찾을 수 없습니다.');

      const { count } = await tx.user.updateMany({
        where: { id: userId, deletedAt: null, status: { not: AccountStatus.SUSPENDED } },
        data: {
          status: AccountStatus.SUSPENDED,
          statusReason: dto.reason,
          suspendedUntil: until,
          // ★ 발급된 JWT 를 전부 무효화한다. 이게 없으면 최대 만료기간(7일)까지 계속 통과한다.
          tokenVersion: { increment: 1 },
        },
      });

      assertAffected(count, 1, 'USER_ALREADY_SUSPENDED');

      await this.audit.append(tx, admin, {
        action: AuditAction.ACCOUNT_SUSPENDED,
        targetType: AuditTargetType.USER,
        targetId: userId,
        targetOwnerUserId: userId,
        summary: `계정 정지: ${dto.reason}`,
        before: { status: before.status },
        after: { status: AccountStatus.SUSPENDED, suspendedUntil: until?.toISOString() ?? null },
        reasonMemo: dto.reason,
        correlationId,
      });

      // 로그인 자체가 막히므로 앱 내 알림은 못 보지만, 아웃박스가 이메일까지 만들어 준다.
      await this.outbox.enqueue(tx, {
        userId,
        type: NotificationType.ACCOUNT_SUSPENDED,
        category: NotificationCategory.ACCOUNT,
        priority: NotificationPriority.CRITICAL,
        titleKo: '계정 이용이 정지되었습니다',
        bodyKo: `사유: ${dto.reason}${
          until ? `\n자동 해제 예정: ${until.toISOString()}` : '\n문의는 고객센터로 연락해 주세요.'
        }`,
        deepLinkPath: '/support',
        dedupeKey: `${NotificationType.ACCOUNT_SUSPENDED}:${correlationId}`,
      });

      return tx.user.findUniqueOrThrow({ where: { id: userId }, select: USER_SELECT });
    });
  }

  /** 해제. tokenVersion 은 올리지 않는다 — 정지 때 이미 올려서 살아있는 토큰이 없다. */
  async reinstate(admin: AuthenticatedUser, userId: string, dto: ReinstateUserDto) {
    const correlationId = randomUUID();

    return this.prisma.$transaction(async (tx) => {
      await this.audit.lock(tx, auditChainKey(AuditTargetType.USER));

      const { count } = await tx.user.updateMany({
        where: { id: userId, deletedAt: null, status: AccountStatus.SUSPENDED },
        data: {
          status: AccountStatus.ACTIVE,
          statusReason: null,
          suspendedUntil: null,
        },
      });

      assertAffected(count, 1, 'USER_NOT_SUSPENDED');

      await this.audit.append(tx, admin, {
        action: AuditAction.ACCOUNT_SUSPENSION_LIFTED,
        targetType: AuditTargetType.USER,
        targetId: userId,
        targetOwnerUserId: userId,
        summary: `계정 정지 해제: ${dto.reason}`,
        before: { status: AccountStatus.SUSPENDED },
        after: { status: AccountStatus.ACTIVE },
        reasonMemo: dto.reason,
        correlationId,
      });

      await this.outbox.enqueue(tx, {
        userId,
        type: NotificationType.ADMIN_ANNOUNCEMENT,
        category: NotificationCategory.ACCOUNT,
        priority: NotificationPriority.HIGH,
        titleKo: '계정 정지가 해제되었습니다',
        bodyKo: '다시 로그인하여 서비스를 이용하실 수 있습니다.',
        deepLinkPath: '/',
        dedupeKey: `ACCOUNT_REINSTATED:${correlationId}`,
      });

      return tx.user.findUniqueOrThrow({ where: { id: userId }, select: USER_SELECT });
    });
  }

  /**
   * 역할 교체. 부분 갱신이 아니라 **전체 집합 교체**다.
   *
   * push/remove 를 따로 두지 않는 이유: 두 운영자가 같은 계정에 각각 붙이고 떼면
   * 마지막 쓰기가 이기는 게 아니라 두 결과가 섞여 아무도 의도하지 않은 조합이 남는다.
   * 전체 집합을 받으면 마지막 쓰기가 명확히 이긴다.
   *
   * ADMIN 을 스스로 떼는 것은 막는다 — 운영자가 0명이 되는 순간 콘솔로 되돌릴 방법이 없다.
   */
  async changeRoles(admin: AuthenticatedUser, userId: string, dto: ChangeUserRolesDto) {
    const roles = [...new Set(dto.roles)];

    if (!roles.includes(UserRole.USER)) {
      throw new BadRequestException('USER 역할은 반드시 포함해야 합니다.');
    }

    if (admin.id === userId && !roles.includes(UserRole.ADMIN)) {
      throw new BadRequestException('자기 계정에서 ADMIN 역할을 뺄 수 없습니다.');
    }

    const correlationId = randomUUID();

    return this.prisma.$transaction(async (tx) => {
      await this.audit.lock(tx, auditChainKey(AuditTargetType.USER));

      const before = await tx.user.findFirst({
        where: { id: userId, deletedAt: null },
        select: { id: true, roles: true },
      });

      if (!before) throw new NotFoundException('계정을 찾을 수 없습니다.');

      const { count } = await tx.user.updateMany({
        where: { id: userId, deletedAt: null, roles: { equals: before.roles } },
        data: {
          roles: { set: roles },
          // 권한이 줄어드는 경우가 있으므로 토큰을 끊는다. 늘어나기만 해도 마찬가지로 끊는 이유는,
          // "역할 변경 = 재로그인"이라는 단순한 규칙이 운영자에게 예측 가능하기 때문이다.
          tokenVersion: { increment: 1 },
        },
      });

      // 0행이면 그 사이 다른 운영자가 역할을 바꿨다는 뜻이다. 덮어쓰지 않고 되돌린다.
      assertAffected(count, 1, 'USER_ROLES_CHANGED');

      await this.audit.append(tx, admin, {
        action: AuditAction.ACCOUNT_ROLE_CHANGED,
        targetType: AuditTargetType.USER,
        targetId: userId,
        targetOwnerUserId: userId,
        summary: `역할 변경: ${before.roles.join(',')} → ${roles.join(',')}`,
        before: { roles: before.roles },
        after: { roles },
        reasonMemo: dto.reason,
        correlationId,
      });

      return tx.user.findUniqueOrThrow({ where: { id: userId }, select: USER_SELECT });
    });
  }
}

/**
 * 목록용 이메일 마스킹.
 * 운영자라도 목록 화면에서 수백 개의 주소를 통째로 볼 이유는 없다 —
 * 화면 캡처 한 장이 그대로 유출이 되는 종류의 정보다.
 */
function maskEmail(email: string | null): string | null {
  if (!email) return null;

  const at = email.indexOf('@');
  if (at <= 0) return '***';

  const head = email.slice(0, at);
  const visible = head.slice(0, Math.min(2, head.length));

  return `${visible}${'*'.repeat(Math.max(head.length - visible.length, 1))}${email.slice(at)}`;
}
