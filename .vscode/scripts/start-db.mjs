// 로컬 Postgres 를 띄우고 준비될 때까지 기다린다.
//
// docker 가 없거나 꺼져 있는 건 흔한 상황이고, 그때 docker 가 뱉는 원문 오류는
// (`open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified`)
// 무엇을 해야 하는지 전혀 알려주지 않는다. 사람이 읽을 수 있는 안내로 바꾼다.
import { execFileSync, execSync } from 'node:child_process';

const COMPOSE_ARGS = ['compose', 'up', '-d'];

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: 'pipe', ...opts });
}

function dockerAvailable() {
  try {
    run('docker', ['info']);
    return true;
  } catch {
    return false;
  }
}

if (!dockerAvailable()) {
  console.error('Docker 에 연결할 수 없습니다.\n');
  console.error('둘 중 하나를 하세요:');
  console.error('  1) Docker Desktop 을 실행한 뒤 이 태스크를 다시 돌린다');
  console.error('  2) 이미 쓰는 Postgres 가 있다면 docker 를 건너뛰고,');
  console.error('     apps/api/.env 의 DATABASE_URL / DIRECT_URL 을 그쪽으로 맞춘다');
  console.error('');
  console.error('     예) postgresql://postgres:비밀번호@localhost:5432/dibs');
  console.error('');
  console.error('  ※ 어느 쪽이든 pg_trgm 과 pgcrypto 확장이 필요합니다:');
  console.error('     CREATE EXTENSION IF NOT EXISTS pg_trgm;');
  console.error('     CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  process.exit(1);
}

console.log('Postgres 컨테이너를 띄웁니다...');

try {
  execSync(`docker ${COMPOSE_ARGS.join(' ')}`, { stdio: 'inherit' });
} catch {
  console.error('\ndocker compose up 이 실패했습니다. 5433 포트가 이미 쓰이고 있는지 확인하세요.');
  process.exit(1);
}

process.stdout.write('준비 대기 ');

for (let i = 0; i < 45; i += 1) {
  try {
    run('docker', ['compose', 'exec', '-T', 'postgres', 'pg_isready', '-U', 'dibs', '-d', 'dibs']);
    console.log(`\n✓ 준비 완료 — postgresql://dibs:dibs@localhost:5433/dibs`);

    // 확장이 실제로 깔렸는지 확인한다. 초기화 스크립트는 볼륨이 비어 있을 때만 도는데,
    // 예전 볼륨이 남아 있으면 조용히 건너뛴 채로 뜬다. 그러면 검색과 감사 로그가 깨진다.
    const ext = run('docker', [
      'compose', 'exec', '-T', 'postgres',
      'psql', '-U', 'dibs', '-d', 'dibs', '-tAc',
      "select coalesce(string_agg(extname, ','), '') from pg_extension where extname in ('pg_trgm','pgcrypto')",
    ]).trim();

    const missing = ['pg_trgm', 'pgcrypto'].filter((e) => !ext.includes(e));

    if (missing.length > 0) {
      console.log(`  확장 설치 중: ${missing.join(', ')}`);
      run('docker', [
        'compose', 'exec', '-T', 'postgres',
        'psql', '-U', 'dibs', '-d', 'dibs', '-c',
        missing.map((e) => `CREATE EXTENSION IF NOT EXISTS ${e};`).join(' '),
      ]);
    }

    console.log('  확장 확인: pg_trgm, pgcrypto ✓');
    process.exit(0);
  } catch {
    process.stdout.write('.');
    execSync(process.platform === 'win32' ? 'timeout /t 1 /nobreak >nul' : 'sleep 1', {
      stdio: 'ignore',
    });
  }
}

console.error('\n45초 안에 준비되지 않았습니다. `docker compose logs postgres` 를 확인하세요.');
process.exit(1);
