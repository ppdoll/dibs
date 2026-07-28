/**
 * API 단위 테스트 설정.
 *
 * roots를 src로 못박는 이유: 기본값이면 빌드 산출물(dist)의 .spec.js 까지 함께 주워서
 * 같은 테스트를 두 번 돌리고, 그중 하나는 낡은 코드를 검증하게 된다.
 * testPathIgnorePatterns 만으로는 부족해서 roots 로 범위 자체를 좁힌다.
 */
module.exports = {
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testEnvironment: 'node',
  testRegex: '\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  // 워크스페이스 패키지는 소스를 직접 물린다. dist 빌드 순서에 테스트가 묶이지 않는다.
  moduleNameMapper: {
    '^@dibs/shared$': '<rootDir>/../../packages/shared/src/index.ts',
  },
  clearMocks: true,
};
