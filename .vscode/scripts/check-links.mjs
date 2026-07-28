// 코드 안의 내부 링크(href="/...")가 실제 App Router 라우트와 맞는지 전수 검사한다.
//
// /partner/selections 처럼 "사이드바는 가리키는데 페이지가 없는" 링크는 타입체크도
// 빌드도 잡아주지 못한다. Next.js 는 Link 의 href 를 문자열로만 보기 때문이다.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const WEB = 'C:/forWife/Dibs/apps/web';
const APP = join(WEB, 'src/app');

/** page.tsx 를 훑어 실제 라우트 목록을 만든다. 라우트 그룹 (main) 은 URL 에서 빠진다. */
function collectRoutes(dir, prefix = '') {
  const routes = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (!statSync(full).isDirectory()) {
      if (name === 'page.tsx' || name === 'page.ts') routes.push(prefix || '/');
      continue;
    }
    if (name.startsWith('_')) continue; // _components 등은 라우트가 아니다
    const segment = name.startsWith('(') && name.endsWith(')') ? '' : `/${name}`;
    routes.push(...collectRoutes(full, prefix + segment));
  }
  return routes;
}

const routes = collectRoutes(APP);

/** /events/[eventId] → ^/events/[^/]+$ */
const matchers = routes.map((r) => ({
  route: r,
  re: new RegExp('^' + r.replace(/\[\.\.\..+?\]/g, '.+').replace(/\[.+?\]/g, '[^/]+') + '$'),
}));

function collectFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...collectFiles(full));
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

// href="/..." 와 router.push('/...') 를 본다. 템플릿 리터럴은 정적 부분만으로 판단할 수
// 없으므로, ${...} 가 들어간 것은 그 자리를 와일드카드로 바꿔 검사한다.
const HREF = /(?:href|router\.(?:push|replace))[=(]\s*[{("'`]([^"'`)}]*)/g;

const problems = [];

for (const file of collectFiles(join(WEB, 'src'))) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(HREF)) {
    let path = m[1];
    if (!path.startsWith('/')) continue; // 외부 링크·상대경로·변수는 건너뛴다
    if (path.startsWith('//')) continue;

    path = path.split('?')[0].split('#')[0];
    // 템플릿 보간을 와일드카드 세그먼트로
    const probe = path.replace(/\$\{[^}]*\}/g, 'X');
    if (probe.includes('${')) continue;

    const hit = matchers.some((mm) => mm.re.test(probe));
    if (!hit) {
      problems.push({ file: relative(WEB, file).replace(/\\/g, '/'), href: path });
    }
  }
}

console.log(`라우트 ${routes.length}개, 검사한 내부 링크에서 문제 ${problems.length}건\n`);

if (problems.length === 0) {
  console.log('깨진 내부 링크 없음 ✓');
} else {
  const byHref = new Map();
  for (const p of problems) {
    if (!byHref.has(p.href)) byHref.set(p.href, []);
    byHref.get(p.href).push(p.file);
  }
  for (const [href, files] of [...byHref].sort()) {
    console.log(`✗ ${href}`);
    for (const f of [...new Set(files)]) console.log(`    ${f}`);
  }
}
