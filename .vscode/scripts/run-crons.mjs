// 스케줄 잡을 한 번 돌린다.
//
// 로컬에는 Vercel Cron 이 없다. 운영에서는 들어오는 요청에 얹힌 TickInterceptor 가
// 60초마다 알아서 굴리지만(docs/DEPLOY.md §4), 로컬에서 "지금 당장" 돌리고 싶을 때가 있다.
// 예약금 만료·순위 확정·메일 발송은 전부 이 잡들이 진행시키므로, 시계를 기다리는 대신
// 여기서 한 방에 때린다.
//
// 실행 순서는 서버가 정한다(TickRegistry 의 order). 개별 잡만 따로 돌리고 싶으면
// 예전 경로가 그대로 살아 있다:
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" localhost:3001/api/cron/expire-holds
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const API = process.env.API_URL ?? 'http://localhost:3001';

function readCronSecret() {
  if (process.env.CRON_SECRET) return process.env.CRON_SECRET;

  try {
    const env = readFileSync(join(ROOT, 'apps', 'api', '.env'), 'utf8');
    const m = /^CRON_SECRET\s*=\s*"?([^"\r\n]+)"?/m.exec(env);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

const secret = readCronSecret();

if (!secret) {
  console.error('CRON_SECRET 을 찾을 수 없습니다. apps/api/.env 에 값이 있어야 합니다.');
  console.error('CronGuard 는 시크릿이 없으면 모든 호출을 401 로 거절합니다 (fail closed).');
  process.exit(1);
}

console.log(`스케줄 틱 → ${API}/api/cron/tick\n`);

let res;
try {
  res = await fetch(`${API}/api/cron/tick`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` },
  });
} catch (err) {
  console.error(`✗ 연결 실패 — API 가 떠 있나요? (${err.message})`);
  process.exit(1);
}

const body = await res.text();

if (!res.ok) {
  console.error(`✗ ${res.status}  ${body.slice(0, 300)}`);
  console.error('');
  console.error('401 이면 CRON_SECRET 불일치, 404 면 서버가 낡은 빌드입니다.');
  process.exit(1);
}

let report;
try {
  report = JSON.parse(body);
} catch {
  console.log(body.slice(0, 500));
  process.exit(0);
}

for (const job of report.results ?? []) {
  const label = `  ${job.job.padEnd(34)}`;

  if (!job.ok) {
    console.log(`${label} ✗ ${job.error ?? '실패'}`);
    continue;
  }

  // 무엇이 실제로 바뀌었는지가 알고 싶은 전부다. 0 만 잔뜩이면 아무 일도 안 한 것.
  const changed = Object.entries(job.result ?? {})
    .filter(([, v]) => typeof v === 'number' && v > 0)
    .map(([k, v]) => `${k}=${v}`);

  console.log(`${label} ✓ ${changed.length > 0 ? changed.join(' ') : '변화 없음'}`);
}

console.log('');

if ((report.failed ?? 0) > 0) {
  console.log(`잡 ${report.ran}개 중 ${report.failed}개 실패 (${report.ms}ms).`);
  console.log('실패한 잡은 다음 틱이 다시 집습니다 — 전부 at-least-once 입니다.');
  process.exitCode = 1;
} else {
  console.log(`잡 ${report.ran}개 전부 성공 (${report.ms}ms). 화면을 새로고침하면 반영돼 있습니다.`);
}
