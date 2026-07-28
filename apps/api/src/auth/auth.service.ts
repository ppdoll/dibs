import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AccountStatus, PartnerApprovalStatus, UserRole } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from '../common/types/authenticated-user';
import type { GoogleIdentity } from './strategies/google.strategy';
import type { SignupIntent, SubmitPartnerApplicationDto } from './dto/auth.dto';

/** 파트너 심사 목표 처리 시간 */
const PARTNER_SLA_HOURS = 72;

/**
 * "아직 구글에 연결되지 않음"을 뜻하는 googleSub 접두사.
 *
 * User.googleSub 은 NULL 이 될 수 없다(user_identity_present_chk). 그래서 시드가
 * 만드는 계정에는 이 접두사를 붙인 자리표시자를 넣고, 첫 구글 로그인 때 진짜 값으로
 * 바꾼다. prisma/seed.ts 와 seed-minimal.ts 가 같은 접두사를 쓴다 — 바꾸려면 함께 바꿔야 한다.
 */
const UNLINKED_GOOGLE_SUB_PREFIX = 'seed-';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * 구글 신원으로 로그인하거나 가입시킨다.
   *
   * googleSub를 기준으로 찾는다 — 이메일은 바뀔 수 있지만 sub는 안 바뀐다.
   * 이메일로 찾으면 구글에서 주소를 바꾼 사용자가 새 계정이 되어버린다.
   */
  async loginWithGoogle(identity: GoogleIdentity, intent: SignupIntent | undefined) {
    const existing = await this.prisma.user.findUnique({
      where: { googleSub: identity.googleSub },
      select: { id: true, deletedAt: true, status: true },
    });

    if (existing?.deletedAt) {
      throw new BadRequestException('탈퇴한 계정입니다. 고객센터로 문의해 주세요.');
    }

    // 아직 구글에 연결되지 않은 계정(시드로 만든 운영자 등)을 이 로그인으로 인수할 수 있는지 본다.
    const claimed = existing ? null : await this.claimUnlinkedAccount(identity);

    const user = existing
      ? await this.recordLogin(existing.id, identity)
      : claimed
        ? await this.recordLogin(claimed.id, identity)
        : await this.createUser(identity, intent);

    // 기존 회원이 파트너로 로그인을 시도했는데 아직 파트너가 아니면,
    // 여기서 역할을 붙이지 않는다. 파트너 전환은 신청서를 내야 시작된다.
    // 무심코 누른 것만으로 역할이 붙으면 승인 큐가 빈 신청서로 찬다.

    return {
      accessToken: await this.issueToken(user.id, user.tokenVersion),
      isNewUser: !existing && !claimed,
      userId: user.id,
    };
  }

  /**
   * 아직 구글에 연결되지 않은 계정을 이 로그인으로 인수한다.
   *
   * 왜 필요한가: 운영자는 셀프가입이 불가능해서(D-09) 시드로만 만들어지는데,
   * 그때는 진짜 googleSub 을 알 수 없어 `seed-...` 자리표시자를 넣어 둔다.
   * 그 상태로 구글 로그인을 하면 googleSub 조회가 빗나가 **신규 가입 경로로 빠지고**,
   * 이메일 유니크에 걸려 로그인이 실패한다. 운영자가 자기 콘솔에 못 들어가는 것이다.
   *
   * 인수 조건은 셋을 **모두** 만족해야 한다. 하나라도 빠지면 계정 탈취 경로가 된다.
   *   1. 같은 이메일의 살아 있는 계정이 있다
   *   2. 그 계정이 **아직 어떤 구글 계정과도 연결되지 않았다**(`seed-` 자리표시자)
   *   3. 구글이 그 이메일을 **인증된 것으로** 확인해 준다
   *
   * 3번이 핵심이다. 구글이 소유를 보증하지 않는 이메일로 남의 계정을 집어갈 수 없어야 한다.
   * 이미 다른 구글 계정에 연결된 행은 절대 건드리지 않는다 — 그건 인수가 아니라 탈취다.
   */
  private async claimUnlinkedAccount(identity: GoogleIdentity) {
    if (!identity.email || !identity.emailVerified) return null;

    const candidate = await this.prisma.user.findUnique({
      where: { email: identity.email },
      select: { id: true, googleSub: true, deletedAt: true, displayName: true },
    });

    if (!candidate || candidate.deletedAt) return null;

    if (!candidate.googleSub?.startsWith(UNLINKED_GOOGLE_SUB_PREFIX)) {
      // 이미 다른 구글 계정에 묶여 있다. 같은 이메일로 두 개의 구글 계정이 존재할 수는
      // 없으니 사실상 도달하지 않지만, 도달했다면 조용히 넘기지 않고 분명히 알린다.
      throw new BadRequestException(
        '이 이메일로 이미 다른 계정이 연결되어 있습니다. 고객센터로 문의해 주세요.',
      );
    }

    const linked = await this.prisma.user.update({
      where: { id: candidate.id },
      data: { googleSub: identity.googleSub, emailVerifiedAt: new Date() },
      select: { id: true },
    });

    this.logger.warn(
      `구글 계정 연결: ${candidate.displayName}(${identity.email}) — 자리표시자 계정을 인수했습니다.`,
    );

    return linked;
  }

  private async createUser(identity: GoogleIdentity, intent: SignupIntent | undefined) {
    const wantsPartner = intent === 'PARTNER';

    return this.prisma.user.create({
      data: {
        googleSub: identity.googleSub,
        email: identity.email,
        emailVerifiedAt: identity.emailVerified ? new Date() : null,
        googleProfileRaw: identity.raw as never,
        displayName: identity.displayName.slice(0, 20),
        avatarUrl: identity.avatarUrl,
        // 파트너를 원해도 역할은 USER + PARTNER 둘 다 준다. 파트너로
        // "활동"할 수 있는지는 PartnerProfile.approvalStatus가 정한다.
        roles: wantsPartner ? [UserRole.USER, UserRole.PARTNER] : [UserRole.USER],
        status: AccountStatus.ACTIVE,
        lastLoginAt: new Date(),
        loginCount: 1,
        notificationEmail: identity.email,
        // 파트너 의사를 밝혔으면 빈 신청서를 DRAFT로 만들어 둔다.
        // 로그인 직후 바로 이어서 작성할 수 있다.
        ...(wantsPartner && identity.email
          ? {
              partnerProfile: {
                create: {
                  contactName: identity.displayName.slice(0, 50),
                  contactEmail: identity.email,
                  approvalStatus: PartnerApprovalStatus.DRAFT,
                },
              },
            }
          : {}),
      },
      select: { id: true, tokenVersion: true },
    });
  }

  private async recordLogin(userId: string, identity: GoogleIdentity) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        lastLoginAt: new Date(),
        loginCount: { increment: 1 },
        // 구글 쪽에서 바뀐 값은 따라간다. 단 displayName은 사용자가
        // 우리 서비스에서 바꿨을 수 있으므로 덮어쓰지 않는다.
        email: identity.email,
        avatarUrl: identity.avatarUrl,
      },
      select: { id: true, tokenVersion: true },
    });
  }

  private issueToken(userId: string, tokenVersion: number): Promise<string> {
    const payload: JwtPayload = { sub: userId, tv: tokenVersion };
    // 만료는 JwtModule 등록 시 이미 걸어두었다. 여기서 다시 넘기면
    // jsonwebtoken 9의 리터럴 타입과 싸워야 하므로 모듈 설정을 그대로 쓴다.
    return this.jwt.signAsync(payload);
  }

  /**
   * 전체 로그아웃. tokenVersion을 올려 발급된 토큰을 전부 무효화한다.
   * 개별 토큰을 폐기할 저장소가 없으므로 버전으로 통째로 끊는다.
   */
  async logoutEverywhere(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    });
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        roles: true,
        status: true,
        partnerProfile: { select: { id: true, approvalStatus: true } },
      },
    });

    if (!user) throw new NotFoundException('계정을 찾을 수 없습니다.');

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      roles: user.roles,
      status: user.status,
      partnerApproved: user.partnerProfile?.approvalStatus === PartnerApprovalStatus.APPROVED,
      partnerApprovalStatus: user.partnerProfile?.approvalStatus ?? null,
      partnerProfileId: user.partnerProfile?.id ?? null,
    };
  }

  /**
   * 파트너 신청서를 제출한다. (D-09)
   *
   * DRAFT/REJECTED/RESUBMIT_REQUIRED에서만 낼 수 있다. 이미 심사 중이거나
   * 승인된 상태에서 다시 내면 승인 큐가 중복으로 찬다.
   */
  async submitPartnerApplication(userId: string, dto: SubmitPartnerApplicationDto) {
    const submittable: PartnerApprovalStatus[] = [
      PartnerApprovalStatus.DRAFT,
      PartnerApprovalStatus.REJECTED,
      PartnerApprovalStatus.RESUBMIT_REQUIRED,
    ];

    const now = new Date();
    const slaDueAt = new Date(now.getTime() + PARTNER_SLA_HOURS * 3_600_000);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.partnerProfile.findUnique({
        where: { userId },
        select: { id: true, approvalStatus: true, resubmitCount: true },
      });

      if (existing && !submittable.includes(existing.approvalStatus)) {
        throw new BadRequestException(
          existing.approvalStatus === PartnerApprovalStatus.APPROVED
            ? '이미 승인된 파트너입니다.'
            : '심사가 진행 중입니다. 결과를 기다려 주세요.',
        );
      }

      // 파트너 역할이 없으면 붙여 준다. 신청서를 냈다는 건 의사 표시가 끝났다는 뜻.
      await tx.user.update({
        where: { id: userId },
        data: { roles: { push: UserRole.PARTNER } },
      });

      const data = {
        contactName: dto.contactName,
        contactEmail: dto.contactEmail,
        contactPhone: dto.contactPhone ?? null,
        partnerTermsVersion: dto.partnerTermsVersion,
        partnerTermsAgreedAt: now,
        approvalStatus: PartnerApprovalStatus.PENDING,
        submittedAt: now,
        slaDueAt,
        rejectedAt: null,
        rejectionCode: null,
        rejectionReason: null,
      };

      return existing
        ? tx.partnerProfile.update({
            where: { userId },
            data: { ...data, resubmitCount: { increment: 1 } },
            select: { id: true, approvalStatus: true, submittedAt: true, slaDueAt: true },
          })
        : tx.partnerProfile.create({
            data: { ...data, userId },
            select: { id: true, approvalStatus: true, submittedAt: true, slaDueAt: true },
          });
    });
  }

  /**
   * 로그인 후 돌려보낼 곳을 정한다.
   *
   * 열린 리다이렉트를 막기 위해 **우리 앱 내부 경로만** 허용한다.
   * `//evil.com`처럼 스킴 없는 절대 URL도 막아야 하므로 앞 두 글자를 본다.
   */
  buildRedirectUrl(token: string, redirect: string | undefined): string {
    const base = this.config.getOrThrow<string>('WEB_APP_URL').replace(/\/$/, '');
    const safePath =
      redirect && redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/';

    const url = new URL(`${base}/auth/callback`);
    url.searchParams.set('token', token);
    url.searchParams.set('redirect', safePath);
    return url.toString();
  }
}
