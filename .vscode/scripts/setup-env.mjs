// apps/api/.env 와 apps/web/.env.local 을 만든다.
//
// 루트에 .env 를 두면 아무도 안 읽는다 — NestJS 의 ConfigModule 과 Prisma CLI 는 cwd(=apps/api)를,
// Next.js 는 apps/web 을 본다. 그래서 두 곳에 각각 놓는다.
//
// 이미 있는 파일은 절대 덮어쓰지 않는다. 본인이 넣어둔 구글 시크릿이 날아가면 안 된다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const API_ENV = join(ROOT, 'apps', 'api', '.env');
const WEB_ENV = join(ROOT, 'apps', 'web', '.env.local');
const EXAMPLE = join(ROOT, '.env.example');

/**
 * 기본값은 표준 포트 5432 — WSL 안의 Postgres 나 윈도우 네이티브 설치가 여기에 뜬다.
 *
 * docker-compose.yml 을 쓸 거면 5433 으로 바꿔야 한다(5432 가 이미 점유돼 있을 확률이
 * 높아 한 칸 옆으로 뺐다). Neon 을 쓰면 대시보드의 두 주소를 그대로 붙여넣으면 된다.
 * 어느 쪽이든 Tasks → "DB 연결 확인" 이 맞는지 알려 준다.
 */
const LOCAL_DB = 'postgresql://dibs:dibs@localhost:5432/dibs';

const secret = () => randomBytes(24).toString('base64url');

function writeApiEnv() {
  if (existsSync(API_ENV)) {
    console.log('  건너뜀  apps/api/.env — 이미 있음 (덮어쓰지 않는다)');
    return;
  }

  if (!existsSync(EXAMPLE)) {
    console.error('  실패    .env.example 을 찾을 수 없다');
    process.exitCode = 1;
    return;
  }

  let text = readFileSync(EXAMPLE, 'utf8');

  // 로컬에서 바로 뜨도록 채워 넣는다. 나머지(구글·Resend·Blob)는 비운 채로 둔다.
  const fill = {
    DATABASE_URL: LOCAL_DB,
    DIRECT_URL: LOCAL_DB,
    JWT_SECRET: secret(),
    CRON_SECRET: secret(),
    IP_HASH_SALT: secret(),
  };

  for (const [key, value] of Object.entries(fill)) {
    const re = new RegExp(`^${key}=.*$`, 'm');
    text = re.test(text) ? text.replace(re, `${key}="${value}"`) : `${text}\n${key}="${value}"\n`;
  }

  mkdirSync(dirname(API_ENV), { recursive: true });
  writeFileSync(API_ENV, text, 'utf8');
  console.log('  생성    apps/api/.env  (DB=localhost:5432, 시크릿 3종 자동 생성)');
  console.log('          ※ Postgres 위치가 다르면 DATABASE_URL / DIRECT_URL 을 고치세요.');
}

function writeWebEnv() {
  if (existsSync(WEB_ENV)) {
    console.log('  건너뜀  apps/web/.env.local — 이미 있음');
    return;
  }

  mkdirSync(dirname(WEB_ENV), { recursive: true });
  writeFileSync(
    WEB_ENV,
    [
      '# 웹에 필요한 값은 이거 하나뿐이다. 시크릿은 절대 여기 두지 않는다 —',
      '# NEXT_PUBLIC_ 접두사는 브라우저 번들에 그대로 박힌다.',
      'NEXT_PUBLIC_API_URL="http://localhost:3001"',
      '',
    ].join('\n'),
    'utf8',
  );
  console.log('  생성    apps/web/.env.local');
}

console.log('환경 파일 준비');
writeApiEnv();
writeWebEnv();

console.log('');
console.log('구글 로그인을 쓰려면 apps/api/.env 의 GOOGLE_CLIENT_ID / SECRET 을 채우세요.');
console.log('안 채워도 됩니다 — 개발용 토큰으로 시드 계정에 바로 로그인할 수 있습니다:');
console.log('  Tasks: Run Task → "개발용 토큰 발급"');
