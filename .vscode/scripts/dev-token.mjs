// 시드 계정으로 로그인한다.
//
// 로그인 수단이 구글 하나뿐이라(D-09), Google Cloud 프로젝트를 만들기 전에는 화면을
// 눌러 볼 수가 없다. 서버의 개발 전용 엔드포인트로 토큰을 받아, 앱의 정식 콜백 화면
// (/auth/callback)에 실어 보낸다.
//
// 콘솔에 붙여넣게 하지 않는 이유: Chrome 은 DevTools 콘솔 붙여넣기를 기본 차단하고
// "allow pasting" 을 타이핑하게 만든다. 게다가 콜백 화면은 토큰을 저장한 뒤
// history.replaceState 로 주소창을 청소해 주므로, 이쪽이 더 안전하기까지 하다.
import { execFile } from 'node:child_process';

const API = process.env.API_URL ?? 'http://localhost:3001';
const WEB = process.env.WEB_URL ?? 'http://localhost:3000';

const email = process.argv[2];

/**
 * 이동할 내부 경로. 기본 '/'.
 *
 * Git Bash(MSYS)는 `/partner` 처럼 슬래시로 시작하는 인자를 윈도우 경로로 자동 변환한다
 * (`C:/Program Files/Git/partner`). 그대로 두면 프론트의 sanitizeRedirect 가 걸러내
 * 조용히 홈으로 가버려서, 왜 안 가는지 알 수가 없다. 여기서 되돌려 준다.
 */
function normalizeRedirect(raw) {
  if (!raw) return '/';

  // MSYS 가 붙인 접두사를 떼어낸다: C:/Program Files/Git/partner → /partner
  const demangled = raw.replace(/^[A-Za-z]:[\\/].*?[\\/]Git[\\/]/i, '/').replace(/\\/g, '/');

  if (!demangled.startsWith('/') || demangled.startsWith('//') || demangled.includes(':')) {
    console.error(`경고: redirect "${raw}" 를 해석할 수 없어 홈(/)으로 보냅니다.`);
    return '/';
  }
  return demangled;
}

const redirect = normalizeRedirect(process.argv[3]);

if (!email) {
  console.error('사용법: node .vscode/scripts/dev-token.mjs <email> [이동할경로]');
  console.error('예:     node .vscode/scripts/dev-token.mjs u1@dibs.demo /my/applications');
  process.exit(1);
}

let res;
try {
  res = await fetch(`${API}/api/auth/dev-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
} catch (err) {
  console.error(`API 에 연결하지 못했습니다 (${API}).`);
  console.error('먼저 F5 로 "🚀 전체 (API + Web)" 을 띄우세요.');
  console.error(`  ${err.message}`);
  process.exit(1);
}

const text = await res.text();

if (!res.ok) {
  console.error(`실패 ${res.status}`);
  console.error(text);
  if (res.status === 400) console.error('\n시드를 먼저 돌려야 합니다: Tasks → "시드 데이터 넣기"');
  if (res.status === 403) console.error('\nNODE_ENV=production 에서는 막혀 있습니다(의도된 동작).');
  process.exit(1);
}

const { accessToken } = JSON.parse(text);

// 앱의 정식 로그인 콜백. 토큰을 저장하고 주소창에서 토큰을 지운 뒤 redirect 로 보낸다.
const loginUrl =
  `${WEB}/auth/callback?token=${encodeURIComponent(accessToken)}` +
  `&redirect=${encodeURIComponent(redirect)}`;

console.log(`\n✓ ${email} 로그인 링크\n`);
console.log(loginUrl);
console.log('');

// 기본 브라우저로 바로 연다. 실패해도 위 URL 을 직접 열면 되므로 조용히 넘어간다.
//
// 윈도우에서 `cmd /c start <url>` 을 쓰지 않는 이유: URL 의 `&` 를 cmd 가 명령 구분자로
// 읽어 주소가 잘린다. PowerShell 의 Start-Process 에 작은따옴표로 감싸 넘기면 안전하다.
const opener =
  process.platform === 'win32'
    ? ['powershell', ['-NoProfile', '-Command', `Start-Process '${loginUrl.replace(/'/g, "''")}'`]]
    : process.platform === 'darwin'
      ? ['open', [loginUrl]]
      : ['xdg-open', [loginUrl]];

execFile(opener[0], opener[1], (err) => {
  if (err) {
    console.log('브라우저를 자동으로 열지 못했습니다. 위 주소를 직접 열어 주세요.');
  } else {
    console.log('브라우저를 열었습니다. 로그인된 상태로 이동합니다.');
  }
  console.log('');
});
