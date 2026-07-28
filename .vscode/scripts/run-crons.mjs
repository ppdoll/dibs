// 크론 엔드포인트를 순서대로 한 번씩 호출한다.
//
// 서버리스 전제라 로컬에는 크론이 없다. 예약금 만료·순위 확정·메일 발송은 전부 크론이
// 진행시키므로, 손으로 때려 주지 않으면 시간이 흘러도 아무 일도 일어나지 않는다.
//
// 순서가 있다: 이벤트 상태를 먼저 따라잡아야(마감) 순위 확정이 대상 이벤트를 찾는다.
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

/** 실행 순서가 곧 인과관계다. 위에서 아래로. */
const ROUTES = [
  ['/api/cron/events/lifecycle', '이벤트 상태 따라잡기 (예정→진행, 진행→마감)'],
  ['/api/cron/expire-holds', '예약금 만료 스위퍼 (자리 반환 / 롤백)'],
  ['/api/cron/deposit-reminders', '예약금 납부 리마인더'],
  ['/api/cron/finalize-rankings', '순위 확정 · 선정 라운드 열기'],
  ['/api/cron/events/stats-refresh', '경쟁률 집계 + 정원 실측 대사'],
  ['/api/cron/notifications/expand-broadcasts', '공지 수신자 팬아웃'],
  ['/api/cron/notifications/dispatch', '이메일 아웃박스 발송'],
  ['/api/cron/notifications/sweep-expired', '만료 알림 정리'],
];

console.log(`크론 실행 → ${API}\n`);

let failed = 0;

for (const [path, label] of ROUTES) {
  process.stdout.write(`  ${label.padEnd(34)} `);

  try {
    const res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
    });

    const body = await res.text();

    if (!res.ok) {
      failed += 1;
      console.log(`✗ ${res.status}  ${body.slice(0, 160)}`);
      continue;
    }

    // 무엇이 실제로 바뀌었는지가 알고 싶은 전부다. 0 만 잔뜩 나오면 아무 일도 안 한 것.
    let summary = body.slice(0, 160);
    try {
      const json = JSON.parse(body);
      const changed = Object.entries(json)
        .filter(([, v]) => typeof v === 'number' && v > 0)
        .map(([k, v]) => `${k}=${v}`);
      summary = changed.length > 0 ? changed.join(' ') : '변화 없음';
    } catch {
      /* JSON 이 아니면 원문 앞부분을 그대로 */
    }

    console.log(`✓ ${summary}`);
  } catch (err) {
    failed += 1;
    console.log(`✗ 연결 실패 — API 가 떠 있나요? (${err.message})`);
  }
}

console.log('');

if (failed > 0) {
  console.log(`${failed}개 실패. 401 이면 CRON_SECRET 불일치, 404 면 서버가 낡은 빌드입니다.`);
  process.exitCode = 1;
} else {
  console.log('전부 성공. 화면을 새로고침하면 반영돼 있습니다.');
}
