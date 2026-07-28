import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = 'C:\\forWife\\Dibs\\apps\\api\\src';
const OUT = 'C:\\forWife\\Dibs\\docs\\API-ROUTES.md';

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.name.endsWith('.controller.ts')) out.push(p);
  }
  return out;
}

// All 은 크론 엔드포인트가 쓴다 — Vercel Cron 이 GET 으로 호출하기 때문이다.
const METHODS = ['Get', 'Post', 'Patch', 'Put', 'Delete', 'All'];
const sections = [];

for (const file of walk(SRC).sort()) {
  const text = readFileSync(file, 'utf8');
  const rel = relative(SRC, file).replace(/\\/g, '/');

  const ctrl = /@Controller\(\s*['"`]([^'"`]*)['"`]?\s*\)/.exec(text);
  const base = ctrl ? ctrl[1] : '';

  const lines = text.split('\n');
  const routes = [];

  // 클래스 레벨 가드/역할
  const classPublic = /@Public\(\)[\s\S]{0,200}@Controller/.test(text);
  const classRoles = /@Roles\(([^)]*)\)[\s\S]{0,300}@Controller/.exec(text);

  for (let i = 0; i < lines.length; i += 1) {
    const m = new RegExp(`@(${METHODS.join('|')})\\(\\s*['"\`]?([^'"\`)]*)['"\`]?\\s*\\)`).exec(lines[i]);
    if (!m) continue;

    // 데코레이터 블록을 위로 훑어 인증/역할/설명을 모은다
    let auth = [];
    let summary = '';
    for (let j = Math.max(0, i - 12); j < Math.min(lines.length, i + 12); j += 1) {
      const l = lines[j];
      if (/@Public\(\)/.test(l)) auth.push('public');
      const r = /@Roles\(([^)]*)\)/.exec(l);
      if (r) auth.push(r[1].replace(/UserRole\./g, '').replace(/\s+/g, ''));
      if (/@RequireApprovedPartner\(\)/.test(l)) auth.push('approved-partner');
      if (/CronGuard/.test(l)) auth.push('cron');
      const s = /summary:\s*['"`]([^'"`]+)['"`]/.exec(l);
      if (s && !summary) summary = s[1];
    }
    if (auth.length === 0) auth.push(classPublic ? 'public' : classRoles ? classRoles[1].replace(/UserRole\./g, '') : 'JWT');

    const sub = m[2] ?? '';
    const full = ['/api', base, sub].filter(Boolean).join('/').replace(/\/+/g, '/');
    routes.push({ method: m[1].toUpperCase(), path: full, auth: [...new Set(auth)].join('+'), summary });
  }

  if (routes.length > 0) sections.push({ rel, routes });
}

const total = sections.reduce((n, s) => n + s.routes.length, 0);

let md = `# Dibs — API 라우트 목록\n\n`;
md += `> 컨트롤러에서 자동 추출했다. 총 **${total}개** 엔드포인트, 컨트롤러 ${sections.length}개.\n`;
md += `> 전역 prefix는 \`api\` (health 제외). 인증은 기본 필수이고 \`public\`만 열려 있다.\n\n`;

for (const s of sections) {
  md += `## \`${s.rel}\`\n\n| Method | Path | Auth | 설명 |\n|---|---|---|---|\n`;
  for (const r of s.routes) {
    md += `| ${r.method} | \`${r.path}\` | ${r.auth} | ${r.summary} |\n`;
  }
  md += '\n';
}

writeFileSync(OUT, md, 'utf8');
console.log(`${total} routes across ${sections.length} controllers -> ${OUT}`);
for (const s of sections) console.log(`  ${s.routes.length.toString().padStart(3)}  ${s.rel}`);
