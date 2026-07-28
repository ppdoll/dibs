// apps/api/.env 의 DATABASE_URL 이 가리키는 DB 를 점검한다.
//
// Docker 든, WSL 안의 Postgres 든, Neon 이든 상관없다 — 이 프로젝트가 요구하는 건
// "붙을 수 있는 Postgres + pg_trgm + pgcrypto" 뿐이다. 무엇을 쓰든 여기서 확인한다.
//
// 실행: cwd 를 apps/api 로 두고 돌려야 한다.
//
// import 문을 쓰지 않는 이유: ESM 은 **스크립트 파일 위치** 기준으로 모듈을 찾는데,
// 이 파일은 .vscode/scripts 에 있고 pnpm 은 호이스팅을 하지 않는다. 그래서 여기서는
// @prisma/client 가 안 잡힌다. cwd(=apps/api) 기준으로 해석하도록 createRequire 를 쓴다.
import { createRequire } from 'node:module';
import { join } from 'node:path';

const requireFromCwd = createRequire(join(process.cwd(), 'package.json'));

let PrismaClient;
try {
  ({ PrismaClient } = requireFromCwd('@prisma/client'));
} catch {
  console.error('@prisma/client 를 찾을 수 없습니다.');
  console.error('이 스크립트는 apps/api 에서 실행해야 합니다. 그리고 먼저:');
  console.error('  pnpm install && pnpm --filter @dibs/api db:generate');
  process.exit(1);
}

const url = process.env.DATABASE_URL;

if (!url) {
  console.error('DATABASE_URL 이 없습니다. 먼저 Tasks → "env 파일 만들기" 를 돌리세요.');
  process.exit(1);
}

// 비밀번호는 가리고 어디에 붙는지만 보여준다.
const shown = url.replace(/:\/\/([^:]+):[^@]*@/, '://$1:****@');
console.log(`대상: ${shown}\n`);

const prisma = new PrismaClient({ log: [] });

try {
  const [{ version }] = await prisma.$queryRaw`SELECT version()`;
  console.log(`✓ 연결됨`);
  console.log(`  ${version.split(',')[0]}`);
} catch (err) {
  console.error('✗ 연결 실패\n');

  // Prisma 의 오류 첫 줄은 "Invalid `prisma.$queryRaw()` invocation:" 같은 껍데기다.
  // 실제 원인("Can't reach database server at ...")은 그 아래에 있으므로 골라낸다.
  const lines = String(err.message)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !l.startsWith('Invalid `') && !/^\d+\s/.test(l));

  const cause = lines.find((l) => /reach|refused|authentication|does not exist|timeout|ENOTFOUND|ECONN/i.test(l));

  console.error(`  ${cause ?? lines[lines.length - 1] ?? err.message}\n`);
  console.error('점검할 것:');
  console.error('  · Postgres 가 실제로 떠 있는가');
  console.error('  · apps/api/.env 의 DATABASE_URL 호스트/포트/비밀번호가 맞는가');
  console.error('  · WSL 안에 설치했다면 listen_addresses 와 pg_hba.conf 를 열어 줬는가');
  console.error('\n설치 방법은 Tasks → "DB 설치 방법 보기" 를 참고하세요.');
  await prisma.$disconnect();
  process.exit(1);
}

// pg_trgm: 한글 부분일치 검색. pgcrypto: 감사 로그 해시 체인(digest).
// 마이그레이션이 이 확장들을 CREATE EXTENSION 으로 만들지만, 권한이 없는 DB 도 있어
// 여기서 미리 확인해 둔다. 없으면 마이그레이션이 GIN 인덱스에서 실패한다.
const REQUIRED = ['pg_trgm', 'pgcrypto'];

const installed = await prisma.$queryRaw`
  SELECT extname FROM pg_extension WHERE extname = ANY(${REQUIRED})
`;
const have = new Set(installed.map((r) => r.extname));
const missing = REQUIRED.filter((e) => !have.has(e));

if (missing.length === 0) {
  console.log(`✓ 확장 설치됨: ${REQUIRED.join(', ')}`);
} else {
  console.log(`· 확장 없음: ${missing.join(', ')} — 설치를 시도합니다`);

  for (const ext of missing) {
    try {
      // 식별자라 파라미터 바인딩이 안 된다. 값은 위 상수 배열에서만 오므로 안전하다.
      await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS ${ext}`);
      console.log(`  ✓ ${ext} 설치 완료`);
    } catch (err) {
      console.error(`  ✗ ${ext} 설치 실패 — ${String(err.message).split('\n')[0]}`);
      console.error(`    수퍼유저 권한이 필요합니다. DB 관리자에게 요청하거나 직접 실행하세요:`);
      console.error(`      CREATE EXTENSION IF NOT EXISTS ${ext};`);
      await prisma.$disconnect();
      process.exit(1);
    }
  }
}

// 이미 스키마가 올라가 있는지 — 최초 세팅인지 재실행인지 구분해서 다음 단계를 안내한다.
const tables = await prisma.$queryRaw`
  SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'
`;
const tableCount = tables[0]?.n ?? 0;

console.log('');
if (tableCount === 0) {
  console.log('스키마가 비어 있습니다. 다음 단계: 마이그레이션 → 시드');
} else {
  console.log(`public 스키마에 테이블 ${tableCount}개가 이미 있습니다.`);
}

await prisma.$disconnect();
