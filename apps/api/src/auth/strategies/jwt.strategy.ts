import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AccountStatus, PartnerApprovalStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser, JwtPayload } from '../../common/types/authenticated-user';

/**
 * 매 요청마다 DB와 대조한다.
 *
 * 토큰 안의 역할만 믿으면, 운영자가 계정을 정지시켜도 기존 토큰이 만료될
 * 때까지(기본 7일) 계속 통과한다. 정지·역할 변경·파트너 승인은 즉시
 * 반영돼야 하므로 한 번 더 읽는다. 서버리스라 커넥션이 아깝지만,
 * 인덱스 하나짜리 PK 조회이므로 감당할 만하다.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        displayName: true,
        roles: true,
        status: true,
        tokenVersion: true,
        deletedAt: true,
        partnerProfile: { select: { id: true, approvalStatus: true } },
      },
    });

    if (!user || user.deletedAt) {
      throw new UnauthorizedException('계정을 찾을 수 없습니다.');
    }

    // 로그아웃·비밀번호 재설정·강제 만료는 tokenVersion을 올려서 한다.
    // 발급된 토큰을 개별로 폐기할 수단이 없으니 버전으로 통째로 끊는다.
    if (user.tokenVersion !== payload.tv) {
      throw new UnauthorizedException('다시 로그인해 주세요.');
    }

    if (user.status === AccountStatus.SUSPENDED) {
      throw new UnauthorizedException('이용이 정지된 계정입니다.');
    }

    if (user.status === AccountStatus.WITHDRAWN) {
      throw new UnauthorizedException('탈퇴한 계정입니다.');
    }

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      roles: user.roles,
      partnerApproved: user.partnerProfile?.approvalStatus === PartnerApprovalStatus.APPROVED,
      partnerProfileId: user.partnerProfile?.id ?? null,
    };
  }
}
