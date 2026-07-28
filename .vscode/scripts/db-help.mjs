// Postgres 를 어떻게 마련할지 안내한다. **아무것도 실행하지 않는다** — 출력만 한다.
//
// Docker Desktop 은 WSL 배포판을 새로 만들고 기본 배포판·네트워킹·메모리 배분을 건드린다.
// 이미 쓰는 WSL 이 있으면 그게 깨지는 일이 잦아서, Docker 를 강제하지 않는다.
// 이 프로젝트가 요구하는 건 "붙을 수 있는 Postgres 14+ 와 pg_trgm·pgcrypto" 뿐이다.

const B = '[1m';
const D = '[2m';
const R = '[0m';
const C = '[36m';

const section = (n, title, when) => {
  console.log(`\n${B}${C}[${n}] ${title}${R}`);
  console.log(`${D}    ${when}${R}\n`);
};

console.log(`${B}Postgres 준비하기 — 세 가지 방법${R}`);
console.log(`${D}이 프로젝트는 Postgres 14+ 에 pg_trgm, pgcrypto 확장만 있으면 된다.${R}`);
console.log(`${D}어디에 있든 상관없다. apps/api/.env 의 DATABASE_URL 만 맞추면 끝.${R}`);

// ─────────────────────────────────────────────────────────────────────────────
section('A', 'WSL(Ubuntu) 안에 설치 — Docker 안 씀, 권장', '이미 쓰는 Ubuntu 배포판을 그대로 쓴다. 새 배포판이 생기지 않는다.');

console.log(`  ${D}WSL 터미널에서:${R}`);
console.log(`    sudo apt update && sudo apt install -y postgresql postgresql-contrib`);
console.log(`    sudo service postgresql start`);
console.log('');
console.log(`  ${D}계정과 DB 만들기:${R}`);
console.log(`    sudo -u postgres psql -c "CREATE USER dibs WITH PASSWORD 'dibs' SUPERUSER;"`);
console.log(`    sudo -u postgres createdb -O dibs dibs`);
console.log('');
console.log(`  ${D}확장 설치 (SUPERUSER 로 만들었으면 db-check 가 알아서 해준다):${R}`);
console.log(`    sudo -u postgres psql -d dibs -c "CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS pgcrypto;"`);
console.log('');
console.log(`  ${D}apps/api/.env — WSL2 는 localhost 를 윈도우와 공유한다:${R}`);
console.log(`    DATABASE_URL="postgresql://dibs:dibs@localhost:5432/dibs"`);
console.log(`    DIRECT_URL="postgresql://dibs:dibs@localhost:5432/dibs"`);
console.log('');
console.log(`  ${D}윈도우에서 안 붙으면 WSL 안에서 아래를 확인한다:${R}`);
console.log(`    ${D}/etc/postgresql/*/main/postgresql.conf → listen_addresses = '*'${R}`);
console.log(`    ${D}/etc/postgresql/*/main/pg_hba.conf     → host all all 0.0.0.0/0 scram-sha-256${R}`);
console.log(`    ${D}고친 뒤 sudo service postgresql restart${R}`);
console.log('');
console.log(`  ${D}부팅할 때마다 켜기 귀찮으면 WSL 의 ~/.bashrc 맨 아래에:${R}`);
console.log(`    ${D}sudo service postgresql start >/dev/null 2>&1${R}`);

// ─────────────────────────────────────────────────────────────────────────────
section('B', 'Neon 클라우드 — 아무것도 설치 안 함', '운영 환경(Vercel Postgres = Neon)과 같은 물건이라 동작 차이가 없다. 무료 티어로 충분하다.');

console.log(`  1. https://neon.tech 가입 → 프로젝트 생성 (리전은 Singapore 가 가깝다)`);
console.log(`  2. 대시보드에서 연결 문자열 두 개를 복사한다:`);
console.log(`     ${D}Pooled connection  → DATABASE_URL  (런타임용, -pooler 가 붙어 있다)${R}`);
console.log(`     ${D}Direct connection  → DIRECT_URL    (마이그레이션용)${R}`);
console.log(`  3. apps/api/.env 에 붙여넣는다. pg_trgm·pgcrypto 는 Neon 이 지원하므로`);
console.log(`     Tasks → "DB 연결 확인" 이 알아서 설치한다.`);
console.log('');
console.log(`  ${D}주의: 풀링 주소로는 마이그레이션이 안 된다. 그래서 이 프로젝트는${R}`);
console.log(`  ${D}      DATABASE_URL 과 DIRECT_URL 을 처음부터 나눠 두었다.${R}`);

// ─────────────────────────────────────────────────────────────────────────────
section('C', '윈도우 네이티브 설치', 'WSL 도 Docker 도 건드리지 않는다. 설치 마법사가 있어 가장 단순하다.');

console.log(`  1. https://www.postgresql.org/download/windows/ 에서 설치 (기본 포트 5432)`);
console.log(`  2. 설치 중 정한 postgres 비밀번호를 기억해 둔다.`);
console.log(`  3. ${D}SQL Shell(psql)${R} 을 열고:`);
console.log(`     CREATE USER dibs WITH PASSWORD 'dibs' SUPERUSER;`);
console.log(`     CREATE DATABASE dibs OWNER dibs;`);
console.log(`  4. apps/api/.env:`);
console.log(`     DATABASE_URL="postgresql://dibs:dibs@localhost:5432/dibs"`);
console.log(`     DIRECT_URL="postgresql://dibs:dibs@localhost:5432/dibs"`);

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${B}어느 방법이든 끝나면${R}`);
console.log(`  Tasks → ${C}DB 연결 확인${R}      연결·확장을 점검하고 없으면 확장을 깔아 준다`);
console.log(`  Tasks → ${C}DB 마이그레이션${R}`);
console.log(`  Tasks → ${C}제약 SQL 적용 (필수)${R}`);
console.log(`  Tasks → ${C}시드 데이터 넣기${R}`);
console.log(`\n  ${D}또는 위 네 개를 한 번에: Tasks → "② DB 세팅 (연결 확인 → 마이그레이션 → 제약 → 시드)"${R}\n`);
