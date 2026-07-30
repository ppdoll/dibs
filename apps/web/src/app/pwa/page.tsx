'use client';

import { useCallback, useEffect, useState } from 'react';

import { isIosSafari, useInstallPrompt } from '@/components/pwa/use-install-prompt';

/**
 * 설치 진단 페이지.
 *
 * "PWA 가 안 돼요" 는 원인이 열 갈래인데 증상은 하나다 — 설치 버튼이 안 보인다.
 * 기기마다 무엇이 막혔는지는 그 기기에서만 알 수 있으므로, 판정을 화면으로 옮겼다.
 * 개발자 도구를 열 수 없는 휴대폰에서 특히 쓸모가 있다.
 */

type Status = 'pass' | 'fail' | 'warn' | 'pending';

interface Check {
  label: string;
  status: Status;
  detail: string;
}

export default function PwaDiagnosticsPage() {
  const { state, install, canPrompt } = useInstallPrompt();
  const [checks, setChecks] = useState<Check[]>([]);
  const [ios, setIos] = useState(false);
  const [installResult, setInstallResult] = useState<string | null>(null);

  const run = useCallback(async () => {
    setIos(isIosSafari());
    setChecks(await collectChecks());
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  const onInstall = useCallback(async () => {
    const outcome = await install();
    setInstallResult(
      outcome === 'accepted'
        ? '설치를 수락했습니다.'
        : outcome === 'dismissed'
          ? '설치를 취소했습니다. 다시 하려면 새로고침하세요.'
          : '이 브라우저는 설치 버튼을 제공하지 않습니다. 아래 수동 설치 안내를 보세요.',
    );
  }, [install]);

  const failed = checks.filter((c) => c.status === 'fail');

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold tracking-tight">앱 설치 진단</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        이 기기에서 홈 화면 설치가 가능한지 확인합니다. 문제가 있으면 아래에 이유가 나옵니다.
      </p>

      <section className="mt-6 rounded-xl border bg-card p-5">
        {state === 'installed' ? (
          <p className="font-semibold text-primary">이미 앱으로 실행 중입니다.</p>
        ) : (
          <>
            <button
              type="button"
              onClick={onInstall}
              disabled={!canPrompt}
              className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-40"
            >
              {canPrompt ? '앱 설치하기' : '이 브라우저는 설치 버튼을 제공하지 않습니다'}
            </button>
            {installResult !== null && (
              <p className="mt-3 text-sm text-muted-foreground">{installResult}</p>
            )}
          </>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-bold text-muted-foreground">설치 조건</h2>
        <ul className="mt-3 space-y-2">
          {checks.length === 0 && <li className="text-sm text-muted-foreground">확인 중…</li>}
          {checks.map((check) => (
            <li key={check.label} className="flex gap-3 rounded-lg border bg-card p-3">
              <span aria-hidden="true" className="mt-0.5 shrink-0">
                {check.status === 'pass' ? '✅' : check.status === 'fail' ? '❌' : check.status === 'warn' ? '⚠️' : '⏳'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{check.label}</span>
                <span className="mt-0.5 block break-words text-xs text-muted-foreground">{check.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {(ios || state === 'manual') && (
        <section className="mt-6 rounded-xl bg-muted/60 p-5">
          <h2 className="font-semibold">수동으로 설치하기</h2>
          {ios ? (
            <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
              <li>
                <strong className="text-foreground">사파리로</strong> 이 페이지를 엽니다. 크롬·네이버·카카오
                인앱 브라우저에서는 설치할 수 없습니다.
              </li>
              <li>아래쪽 가운데 <strong className="text-foreground">공유</strong> 버튼(↑)을 누릅니다.</li>
              <li>
                메뉴를 내려 <strong className="text-foreground">홈 화면에 추가</strong>를 누릅니다.
              </li>
            </ol>
          ) : (
            <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
              <li>
                주소창 오른쪽의 <strong className="text-foreground">설치 아이콘</strong>(⊕ 또는 모니터 모양)을
                누릅니다.
              </li>
              <li>
                안 보이면 브라우저 메뉴(⋮) → <strong className="text-foreground">앱 설치</strong> 또는{' '}
                <strong className="text-foreground">Dibs 설치</strong>를 찾습니다.
              </li>
              <li>
                그래도 없으면 위 목록에서 ❌ 항목을 확인하세요. 하나라도 실패하면 브라우저가 설치를 제안하지
                않습니다.
              </li>
            </ol>
          )}
        </section>
      )}

      {failed.length > 0 && (
        <p className="mt-6 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
          실패한 항목이 {failed.length}개 있습니다. 이 화면을 캡처해서 알려주시면 원인을 좁힐 수 있습니다.
        </p>
      )}
    </main>
  );
}

/**
 * 브라우저가 설치를 제안할 때 보는 조건들을 그대로 따라가며 확인한다.
 * 판정 기준은 크롬 문서의 installability criteria 다.
 */
async function collectChecks(): Promise<Check[]> {
  const checks: Check[] = [];

  checks.push({
    label: '보안 컨텍스트 (HTTPS)',
    status: window.isSecureContext ? 'pass' : 'fail',
    detail: window.isSecureContext
      ? location.origin
      : `${location.origin} — HTTPS 또는 localhost 여야 설치할 수 있습니다.`,
  });

  // ── 매니페스트 ────────────────────────────────────────────────────────────
  const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!link) {
    checks.push({ label: '매니페스트 링크', status: 'fail', detail: '<link rel="manifest"> 가 없습니다.' });
  } else {
    try {
      const res = await fetch(link.href, { cache: 'no-store' });
      const manifest = (await res.json()) as Record<string, unknown>;
      const icons = Array.isArray(manifest.icons) ? (manifest.icons as Array<Record<string, string>>) : [];
      const has = (size: string) => icons.some((i) => (i.sizes ?? '').split(' ').includes(size));

      checks.push({
        label: '매니페스트',
        status: res.ok ? 'pass' : 'fail',
        detail: `${link.href} — HTTP ${res.status}, name="${String(manifest.name ?? '')}", display="${String(manifest.display ?? '')}"`,
      });
      checks.push({
        label: '아이콘 192 · 512',
        status: has('192x192') && has('512x512') ? 'pass' : 'fail',
        detail: icons.map((i) => `${i.src} (${i.sizes}, ${i.purpose ?? 'any'})`).join(' · ') || '없음',
      });

      // 아이콘이 목록에만 있고 실제로 안 받아지면 설치가 조용히 막힌다.
      const probe = await Promise.all(
        icons.map(async (i) => {
          // src 가 없는 항목은 매니페스트가 잘못된 것이다 — 받아볼 대상 자체가 없다.
          if (!i.src) return `${i.sizes ?? '?'}:src없음`;
          try {
            const r = await fetch(new URL(i.src, link.href).href, { cache: 'no-store' });
            return `${i.sizes ?? '?'}:${r.status}`;
          } catch {
            return `${i.sizes ?? '?'}:실패`;
          }
        }),
      );
      checks.push({
        label: '아이콘 실제 응답',
        status: probe.every((p) => p.endsWith(':200')) ? 'pass' : 'fail',
        detail: probe.join(' · ') || '확인할 아이콘 없음',
      });
    } catch (err) {
      checks.push({
        label: '매니페스트',
        status: 'fail',
        detail: `읽지 못했습니다 — ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // ── 서비스 워커 ───────────────────────────────────────────────────────────
  if (!('serviceWorker' in navigator)) {
    checks.push({ label: '서비스 워커', status: 'fail', detail: '이 브라우저는 서비스 워커를 지원하지 않습니다.' });
  } else {
    const registration = await navigator.serviceWorker.getRegistration('/');
    const controlled = navigator.serviceWorker.controller !== null;

    checks.push({
      label: '서비스 워커 등록',
      status: registration ? 'pass' : 'fail',
      detail: registration
        ? `scope=${registration.scope} / active=${registration.active?.state ?? '없음'}`
        : '등록되지 않았습니다. 새로고침해도 그대로면 콘솔의 오류를 확인하세요.',
    });
    checks.push({
      label: '서비스 워커가 이 페이지를 제어 중',
      status: controlled ? 'pass' : 'warn',
      detail: controlled
        ? '제어 중'
        : '첫 방문에서는 정상입니다. 새로고침하면 제어가 시작됩니다.',
    });
  }

  // ── iOS 전용 ──────────────────────────────────────────────────────────────
  if (isIosSafari()) {
    const appleCapable = document.querySelector('meta[name="apple-mobile-web-app-capable"]');
    const appleIcon = document.querySelector('link[rel="apple-touch-icon"]');

    checks.push({
      label: 'iOS 독립 실행 메타',
      status: appleCapable ? 'pass' : 'fail',
      detail: appleCapable
        ? 'apple-mobile-web-app-capable 있음'
        : '없습니다 — 홈 화면에 추가해도 사파리 UI 를 단 채로 열립니다.',
    });
    checks.push({
      label: 'iOS 홈 화면 아이콘',
      status: appleIcon ? 'pass' : 'fail',
      detail: appleIcon?.getAttribute('href') ?? '없습니다 — 아이콘이 페이지 스크린샷으로 만들어집니다.',
    });
  }

  checks.push({
    label: '이미 설치됨?',
    status: window.matchMedia('(display-mode: standalone)').matches ? 'warn' : 'pass',
    detail: window.matchMedia('(display-mode: standalone)').matches
      ? '이미 앱으로 실행 중이라 설치 버튼이 나오지 않습니다.'
      : '브라우저에서 실행 중 — 설치 가능한 상태입니다.',
  });

  return checks;
}
