/**
 * 통합 테스트 설정. 단위 테스트(jest.config.js)와 **의도적으로 분리**돼 있다.
 *
 * 분리한 이유
 *   jest.config.js 는 roots 를 src 로 못박고 `\.spec\.ts$` 만 줍는다. 그 설정에 통합 테스트를
 *   얹으면 DB 가 없는 개발자의 `pnpm test` 가 빨갛게 된다. 여기 있는 테스트는 **진짜 Postgres** 를
 *   요구하므로 실행 경로 자체를 따로 둔다. (테스트 파일 이름도 `.int-spec.ts` 라 위 정규식에 안 걸린다.)
 *
 * maxWorkers: 1 인 이유
 *   예약금 만료 스위퍼(DepositSweeperService)는 **전역** 술어로 돈다 —
 *   `WHERE status='PENDING' AND "dueAt" <= now()`. 파일이 병렬로 돌면 한 파일의 스위퍼가
 *   다른 파일이 방금 만든 홀드를 집어가서, 실패가 재현되지 않는 형태로 섞인다.
 *   같은 이유로 크론 성격의 서비스를 테스트할 때는 **전용 DB** 를 쓰는 게 안전하다.
 *
 * 실행:
 *   DATABASE_URL="postgresql://..." npx jest -c jest.integration.config.js
 *   DATABASE_URL 이 없으면 모든 스위트가 SKIP 된다(실패가 아니다).
 */
module.exports = {
  rootDir: '.',
  roots: ['<rootDir>/test'],
  testEnvironment: 'node',
  testRegex: '\\.int-spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  moduleNameMapper: {
    '^@dibs/shared$': '<rootDir>/../../packages/shared/src/index.ts',
  },
  // NestJS 데코레이터(@Injectable)와 Swagger 데코레이터가 Reflect 메타데이터를 요구한다.
  // main.ts 가 하는 일을 테스트 프로세스에서도 해줘야 서비스 클래스를 그냥 new 할 수 있다.
  setupFiles: ['<rootDir>/test/helpers/jest-setup.ts'],
  clearMocks: true,
  maxWorkers: 1,
  // 동시 신청 테스트는 트랜잭션 8개가 Event 행 락 앞에 줄을 선다. 기본 5초로는 부족하다.
  testTimeout: 120_000,
};
