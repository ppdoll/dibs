import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * 서버리스에서 람다 인스턴스가 재사용될 때마다 새 PrismaClient가 생기면
 * 커넥션이 누수된다. globalThis에 하나만 두고 재사용한다.
 *
 * DATABASE_URL은 pooled(pgbouncer) 주소를, DIRECT_URL은 마이그레이션용
 * 직결 주소를 쓴다. schema.prisma의 datasource가 둘을 구분한다.
 */
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['error', 'warn'],
  });
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    super();
    if (!globalForPrisma.prisma) {
      globalForPrisma.prisma = createClient();
    }
    return globalForPrisma.prisma as PrismaService;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }
}
