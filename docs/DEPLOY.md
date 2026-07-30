# Dibs — Vercel 배포

> 로컬 구동은 [RUNNING.md](RUNNING.md). 이 문서는 **배포 구성과 그렇게 정한 이유**다.

## 지금 배포된 것 (2026-07-30)

| | URL | Vercel 프로젝트 |
|---|---|---|
| 웹 | https://dibs-web-xi.vercel.app | `dibs-web` |
| API | https://dibs-api.vercel.app | `dibs-api` |
| DB | Neon `dibs-db` (Free, `iad1`) | `dibs-api` 에 연결 |

스코프는 개인 계정 `ppdoll-7834s-projects` 다(회사 팀 아님). 플랜은 **Hobby** —
그래서 스케줄러가 §4 처럼 생겼다.

**DB 리전을 함수와 같은 `iad1` 로 맞춘 이유**: 서울(`icn1`)에 두면 요청당 여러 번인
쿼리가 매번 태평양을 왕복한다. 사용자→함수 왕복 한 번이 느린 편이 낫다.
(Hobby 는 함수 리전을 고를 수 없어 `iad1` 고정이다.)

### GitHub 자동 배포

두 프로젝트 모두 https://github.com/ppdoll/dibs 에 연결돼 있다. `main` 에 push 하면 자동 배포된다.

**바뀐 앱만 빌드된다.** 두 프로젝트가 같은 저장소를 보므로 그대로 두면 프론트 한 줄만 고쳐도
API 까지 재빌드된다. Ignored Build Step 에 `turbo-ignore` 를 걸어 두었다:

| 프로젝트 | Ignored Build Step |
|---|---|
| `dibs-api` | `npx turbo-ignore @dibs/api` |
| `dibs-web` | `npx turbo-ignore @dibs/web` |

`packages/shared` 를 고치면 **둘 다** 빌드된다 — 의존 그래프를 보고 판단하기 때문이다. 의도한 동작이다.

CLI 배포도 그대로 된다(저장소 루트에서, Root Directory 설정이 적용되도록):

```bash
VERCEL_ORG_ID=team_HQ2l4HIka2EwxiFpWtffFJiE \
VERCEL_PROJECT_ID=<프로젝트 ID> npx vercel deploy --prod --yes
```

### ⚠ 프리뷰 배포는 운영 DB 를 본다

Neon 통합이 `DATABASE_URL` 을 **Production 과 Preview 양쪽에** 심는다. 반면 `JWT_SECRET`·
`CRON_SECRET` 등 나머지는 Production 에만 넣어 두었다. 그래서 지금 브랜치 프리뷰는
**부팅 단계에서 실패한다** — 의도한 상태다(fail closed).

프리뷰를 쓰려면 나머지 변수를 Preview 에도 넣어야 하는데, **그 순간 프리뷰가 운영 데이터에
쓰기 시작한다.** 먼저 Neon 에 별도 브랜치/DB 를 만들어 Preview 의 `DATABASE_URL` 을
그쪽으로 돌린 다음에 열 것.

---

## 1. Vercel 프로젝트를 **2개** 만든다

하나의 저장소를 두 개의 Vercel 프로젝트에 연결하고, 각각 **Root Directory** 를 다르게 준다.

| Vercel 프로젝트 | Root Directory | 프레임워크 | 도메인(예) |
|---|---|---|---|
| `dibs-web` | `apps/web` | Next.js (자동 감지) | `dibs.example.com` |
| `dibs-api` | `apps/api` | Other (`framework: null`) | `api.dibs.example.com` |

두 프로젝트 모두 **Settings → Build and Deployment → Root Directory** 에서
**"Include source files outside of the Root Directory in the Build Step"** 를 **켠다.**
안 켜면 `packages/shared` 와 `pnpm-lock.yaml` 이 빌드 컨텍스트에 안 들어가서 설치부터 실패한다.

### 왜 rewrite 하나짜리 단일 프로젝트가 아닌가

"프로젝트 하나에 Next.js 를 올리고 `/api/*` 를 서버리스 함수로 rewrite 한다"가 겉보기엔 단순하다.
실제로는 이 프로젝트에서 더 복잡해진다.

- **빌드가 하나로 묶인다.** 프론트 문구 한 줄만 고쳐도 Prisma Client 재생성과 Nest 빌드가 함께 돈다.
  반대로 API 를 롤백하려면 프론트도 같이 롤백된다. 두 앱의 배포 수명이 다른데 하나로 묶이는 셈이다.
- **함수 설정이 충돌한다.** API 는 `memory: 1024`, `maxDuration: 60` 이 필요하고(스위퍼가 200건씩 돈다),
  Next.js 라우트는 그럴 필요가 없다. 한 프로젝트에서는 이 둘을 깔끔히 나누기 어렵다.
- **크론이 애매해진다.** 크론은 프로젝트 단위 설정이다. 프론트 프로젝트가 백엔드 크론을 들고 있게 된다.
- **CORS 를 없애려고 합치는 것**이 보통의 동기인데, 여기서는 이미 `NEXT_PUBLIC_API_URL` 로
  API 주소를 명시하고 `CORS_ORIGINS` 로 출처를 화이트리스트하는 구조라 얻는 게 없다.

프로젝트를 나누면 각 앱이 자기 `vercel.json` 을 갖는다 — 지금 저장소 상태가 그렇다.

### 루트의 `vercel.json`

저장소 루트에도 `vercel.json` 이 있는데, 이것은 **빌드를 일부러 실패시킨다.**

Root Directory 를 `apps/web` 또는 `apps/api` 로 지정하면 Vercel 은 그 디렉터리의 `vercel.json` 을 읽고
루트 파일은 **아예 읽지 않는다.** 즉 이 파일이 읽히는 경우는 하나뿐이다 —
**누군가 Root Directory 를 바꾸지 않은 채 저장소를 연결한 경우.** 그때 조용히 빈 사이트가 배포되느니
빌드 로그에 "프로젝트를 둘로 나눠야 한다"는 한국어 안내를 남기고 실패하는 편이 낫다.

---

## 2. 환경변수

Vercel → 각 프로젝트 → **Settings → Environment Variables**.
전체 목록과 설명은 [`.env.example`](../.env.example) 에 있다. 여기서는 **어느 프로젝트에 무엇을 넣는가**만 적는다.

### `dibs-api`

| 변수 | 값 | 비고 |
|---|---|---|
| `DATABASE_URL` | **풀링(pgbouncer) 주소** + `?sslmode=require&pgbouncer=true&connection_limit=1` | 런타임 전용 |
| `DIRECT_URL` | **직결 주소** (`-pooler` 없음) | 마이그레이션·DDL 전용 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | 구글 콘솔 | |
| `GOOGLE_CALLBACK_URL` | `https://api.dibs.example.com/api/auth/google/callback` | 구글 콘솔에도 **같은 문자열**을 등록 |
| `JWT_SECRET` | 16자 이상 랜덤 | 바꾸면 전원 로그아웃 |
| `WEB_APP_URL` | `https://dibs.example.com` | 로그인 후 되돌아갈 곳 |
| `CORS_ORIGINS` | `https://dibs.example.com` (+ 프리뷰 도메인) | 비우면 `WEB_APP_URL` 하나만 허용 |
| `CRON_SECRET` | 16자 이상 랜덤 | **§4 — 이게 없으면 크론이 전부 죽는다** |
| `IP_HASH_SALT` | 랜덤, **한 번 정하면 안 바꾼다** | 비우면 `JWT_SECRET` 을 쓴다 |
| `RESEND_API_KEY` / `EMAIL_FROM` / `RESEND_WEBHOOK_SECRET` | Resend | 없으면 메일만 안 나간다 |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob 연결 시 자동 주입 | |
| `SWAGGER_ENABLED` | `false` | 운영에서는 API 문서를 닫는다 |
| `DEPOSIT_HOLD_ENABLED` | `false` | 실결제 범위 밖 |

### `dibs-web`

| 변수 | 값 | 비고 |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `https://api.dibs.example.com` | **빌드 시점에 번들에 박힌다** — 값을 바꾸면 반드시 재배포(재빌드)해야 한다. 런타임 변경 불가. |

웹은 이 하나만 있으면 된다. DB 도 시크릿도 프론트 프로젝트에 넣지 않는다.

### `DATABASE_URL` 과 `DIRECT_URL` 을 왜 나누나

- **런타임은 풀링을 써야 한다.** 서버리스 함수는 요청마다 인스턴스가 여러 개 뜬다.
  각자 직결 커넥션을 열면 Postgres 의 `max_connections` 를 금방 태운다.
- **마이그레이션은 풀링을 통과할 수 없다.** pgbouncer 의 transaction 모드는 세션 상태를 보장하지 않는다.
  Prisma Migrate 는 advisory lock 과 세션 단위 DDL 을 쓰므로 풀러 뒤에서는 정상 동작하지 않는다.
  제약 마이그레이션도 마찬가지다 — 트리거·함수 생성은 전부 DDL 이다.
- 그래서 `schema.prisma` 의 datasource 가 `url`(풀링) / `directUrl`(직결) 두 개를 받는다.
  **둘을 바꿔 넣으면** 런타임은 커넥션이 마르고 마이그레이션은 `prepared statement already exists` 로 터진다.

---

## 3. 배포 순서 — **DB 가 먼저다**

첫 배포에서 이 순서를 어기면 API 는 뜨는데 모든 요청이 500 을 낸다.

```bash
# 1) 스키마
DATABASE_URL="<pooled>" DIRECT_URL="<direct>" \
  pnpm --filter @dibs/api exec prisma migrate deploy

# 2) 제약 — Prisma DSL 로 표현할 수 없는 CHECK · 부분 유니크 · 트리거

# 3) 시드 (참조 데이터 + 운영자 계정)
DATABASE_URL="<pooled>" pnpm --filter @dibs/api db:seed

# 4) 그 다음에 배포
#    dibs-api 를 먼저, dibs-web 을 나중에 (웹이 API 주소를 빌드에 박기 때문)
```

**2번을 빼면 앱은 정상으로 보이지만 D-04·D-05·D-06·D-07 을 떠받치는 불변식이 하나도 걸려 있지 않다.**
이 파일은 멱등이므로 이후 모든 마이그레이션 뒤에 다시 돌린다 —
Prisma 는 자기가 만들지 않은 객체를 다음 migrate 에서 DROP 하는 마이그레이션으로 생성한다.

> 빌드 단계에서 `prisma migrate deploy` 를 자동으로 돌리고 싶은 유혹이 있는데, 하지 않는 게 좋다.
> Vercel 빌드는 병렬로 여러 번 돌 수 있고(프리뷰 배포 포함), 프리뷰 빌드가 운영 DB 를 마이그레이션하게 된다.
> 마이그레이션은 사람이 의도적으로 한 번 돌리는 일이다.

각 프로젝트의 빌드 명령은 이미 `vercel.json` 에 들어 있다.

- `apps/api/vercel.json` → `pnpm --filter @dibs/shared build && ... db:generate && ... build`
  `@dibs/shared` 를 먼저 빌드하는 이유: 이 패키지는 `dist` 를 `main` 으로 내보내는데
  API 는 `transpilePackages` 같은 장치가 없어서 소스째로 못 읽는다.
- `apps/web` 은 Next.js 기본값으로 충분하다 (`transpilePackages: ['@dibs/shared']` 로 소스를 직접 가져다 쓴다).

---

## 4. 스케줄러 — 크론 1개 + 요청 구동 틱

### 왜 크론만으로는 안 되는가 ★

스케줄 잡은 8개고 원래는 전부 **매분** 돌았다.
그런데 **Hobby 플랜은 크론을 하루 1회, 최대 2개까지만** 허용한다.
개수는 하나로 합치면 되지만 **주기는 합쳐지지 않는다** — 하루 한 번 도는 스케줄러로
10분짜리 예약금 창을 굴릴 수는 없다.

그래서 스케줄의 **주 동력을 시간에서 트래픽으로 옮겼다.**

| | 무엇이 굴리나 | 언제 |
|---|---|---|
| **주 동력** | `TickInterceptor` — 들어오는 모든 요청에 얹힌다 | 마지막 틱에서 `TICK_INTERVAL_SECONDS`(기본 60초)가 지났으면 |
| **안전망** | Vercel Cron → `/api/cron/tick` | 하루 1회 (03:00 UTC) |

동작은 이렇다.

1. 요청이 들어온다 → 인터셉터가 "틱이 밀렸나?" 를 묻는다.
2. 대부분은 람다 인스턴스 로컬 타이머(10초)에서 걸러져 **DB 도 안 간다.**
3. 통과하면 `CronTick` 게이트 행에 `INSERT … ON CONFLICT DO UPDATE … WHERE "nextRunAt" <= now()`
   한 방을 날린다. 영향 행이 1이면 그 요청이 이번 틱의 주인이다.
   동시에 열 개가 들어와도 UPDATE 가 성립하는 쪽은 정확히 하나다.
4. 주인이 된 요청이 잡 8개를 순서대로 돌린다. **유휴 상태 실측 16~26ms** (조건부 UPDATE 여덟 방).
   콜드스타트가 겹친 첫 요청만 2초대다 — 이건 틱이 아니라 Prisma 엔진 웜업 비용이다.
5. 5초를 넘기면 응답을 먼저 내보낸다(틱은 그대로 진행하되 완주는 보장하지 않는다).

### 트래픽이 없으면 아무것도 안 돈다 — 괜찮은 이유

만료 판정 자체가 **조회 시점 지연 만료(lazy expiry)** 라 데이터 정합성이 깨지지 않는다.
아무도 안 보는 동안 밀리는 것은 **알림 발송과 자리 반환 타이밍**뿐이고,
누군가 들어오는 순간 그 요청이 밀린 것을 전부 따라잡는다.

**분 단위를 확실히 보장하고 싶다면** 무료 업타임 모니터(UptimeRobot 등)로
`https://<api-도메인>/health` 를 1분마다 찌르면 된다. 헬스체크에도 인터셉터가 얹히므로
그 핑 자체가 스케줄러의 시계가 된다. 크론 플랜과 무관하고 비용도 0이다.

> 경로에 `/api` 가 없다. `/health` 는 전역 프리픽스 **밖**에 있다 —
> 플랫폼 헬스체크가 앱 라우팅 규칙을 몰라도 되게 하려는 것이다.

### 잡 목록

`/api/cron/tick` 이 아래를 **이 순서대로** 전부 돌린다.
각 잡은 예전 경로로도 여전히 따로 호출할 수 있다 — 디버깅·수동 복구용이다.

| order | 잡 이름 (= 개별 경로) | 하는 일 |
|---|---|---|
| 10 | `events/lifecycle` | `SCHEDULED→OPEN`, `OPEN→CLOSED` |
| 20 | `expire-holds` | 예약금 홀드 만료 — 자리 반환 / 금액 롤백 |
| 30 | `finalize-rankings` | `rankingLockAt` 대사 + 선정 라운드 개시 |
| 40 | `deposit-reminders` | 만기 임박 리마인더 (홀드당 1회) |
| 50 | `notifications/expand-broadcasts` | 공지 수신자 페이지 확장 |
| 60 | `notifications/dispatch` | 이메일 아웃박스 → Resend |
| 70 | `notifications/sweep-expired` | 만료 알림 소프트 삭제 |
| 80 | `events/stats-refresh` | 경쟁률 집계 + INSTANT `claimedCount` 실측 대사 |

**순서가 의미를 갖는 유일한 쌍은 20 → 30 이다.** 열린 홀드가 하나라도 남아 있으면
확정 게이트가 그 이벤트를 통째로 건너뛴다(IC-26). 뒤집히면 확정이 계속 한 주기씩 밀린다.
나머지는 뒤집혀도 한 주기 밀릴 뿐 결과가 달라지지 않는다 — 전부 현재 상태를 `WHERE` 에
적은 조건부 UPDATE 라 at-least-once 를 전제로 안전하다.

**경쟁률이 스케줄러에 달려 있다는 점을 기억한다.** `liveApplicantCount` 는 신청 트랜잭션이
아니라 `events/stats-refresh` 가 갱신한다. 틱이 안 돌면 화면의 경쟁률이 멈춘다.

### 잡 하나가 죽어도 나머지는 돈다

`TickRegistry` 가 잡마다 try/catch 를 두르고 실패를 리포트에 모은다.
중간에서 throw 하면 뒤의 잡이 통째로 굶기 때문이다. 실패한 잡은 다음 틱이 다시 집는다.

틱 결과는 `/api/cron/tick` 응답으로 그대로 나온다:

```json
{ "trigger": "cron", "ran": 8, "failed": 0, "ms": 143, "results": [ … ] }
```

### `CRON_SECRET` — 안 넣으면 안전망이 조용히 꺼진다 ★

Vercel 은 `CRON_SECRET` 이 설정돼 있으면 크론 요청에
`Authorization: Bearer $CRON_SECRET` 헤더를 붙여 보낸다.

`CronGuard` 는 **`CRON_SECRET` 이 비어 있으면 모든 크론 요청을 401 로 거절한다.**
"시크릿이 없으니 그냥 통과"가 아니라 **fail closed** 다 — 열어두면 아무나 만료 스위퍼와
순위 확정을 때릴 수 있기 때문이다.

> 요청 구동 틱은 `CRON_SECRET` 과 무관하게 돈다(가드를 타지 않는 인터셉터다).
> 즉 시크릿을 빼먹어도 **트래픽이 있는 동안은 정상 동작한다.** 대신 안전망이 사라지므로
> 트래픽이 끊긴 밤사이에 아무것도 처리되지 않는다. 첫 배포 직후 Vercel →
> **Cron Jobs** 탭에서 응답이 401 이 아닌지 한 번 확인한다.

### 플랜을 Pro 로 올린다면

`apps/api/vercel.json` 의 `crons` 를 예전처럼 되돌리면 된다 — 개별 경로 8개가 그대로 살아 있다.
요청 구동 틱을 끄고 싶으면 `TICK_INTERVAL_SECONDS` 를 아주 크게(예: `86400`) 두면
사실상 크론만 남는다. 둘을 같이 굴려도 무해하다(게이트가 중복을 막는다).

---

## 5. 서버리스라서 감수하는 것들

### 콜드스타트

NestJS 는 부팅할 때 전체 DI 그래프를 만든다 — 서버리스 함수 기준으로는 무거운 편이다.
`apps/api/api/index.ts` 가 Nest 앱을 **모듈 스코프에 캐시**하고, 동시에 들어온 첫 요청들이 각자 부팅하지
않도록 **Promise 자체를 캐시**한다. 그래도 인스턴스가 새로 뜰 때의 첫 요청은 느리다.

이것이 시간에 민감한 로직을 애플리케이션 타이머로 만들지 않는 이유이기도 하다.
시간의 원천은 언제나 DB 의 `now()` 하나다(IC-04).

### WebSocket 이 없다 → 경쟁률은 폴링이다

Vercel 서버리스 함수는 상주 프로세스가 아니라서 WebSocket 연결을 유지할 수 없다.
그래서 이벤트 상세의 실시간 경쟁률은 **서버가 밀어주는(push)** 게 아니라
**프론트가 주기적으로 다시 물어보는(poll)** 방식이다.

이 선택은 D-07 과도 맞물린다. 공개되는 정보가 경쟁률 하나뿐이라 갱신이 몇 초 늦어도 손해가 없다.
금액이나 순위를 실시간으로 보여줬다면 폴링 지연이 곧 불공정이 됐겠지만, 그건 애초에 공개하지 않는다.

### 첫 배포에서 확인할 것 — Nest DI 와 데코레이터 메타데이터

Vercel 의 Node 런타임은 TypeScript 를 esbuild 계열로 변환한다.
NestJS 의 생성자 주입은 `emitDecoratorMetadata` 가 만들어 주는 `design:paramtypes` 에 의존하는데,
이 메타데이터를 내보내지 못하는 변환기가 있다.

첫 배포 후 함수 로그에 아래 같은 오류가 뜨면 이 문제다.

```
Nest can't resolve dependencies of the XxxService (?). Please make sure that the argument
dependency at index [0] is available in the XxxModule context.
```

해결: `nest build` 결과(`dist/`)를 배포에 포함시키고 `api/index.ts` 가 소스(`../src/bootstrap`) 대신
빌드 산출물(`../dist/src/bootstrap`)을 import 하도록 바꾼다. `tsc` 는 `emitDecoratorMetadata` 를 제대로 내보낸다.
(`apps/api/vercel.json` 의 `buildCommand` 는 이미 `nest build` 를 돌리고 있으므로 `dist/` 는 만들어져 있다.)

---

## 6. 배포 후 점검 목록

1. `https://api.dibs.example.com/health` 가 응답하는가.
   현재 이 라우트에는 `@Public()` 이 없어서 전역 JWT 가드에 걸린다 — **토큰 없이 열면 401 이 정상**이고,
   그것만으로도 "부팅과 라우팅은 성공"을 확인할 수 있다. 502/504 면 부팅 자체가 실패한 것이다.
   외부 모니터링에 물릴 계획이면 `HealthController` 에 `@Public()` 을 붙여 200 + `{"db":"ok"}` 가 나오게 한다.
2. `https://api.dibs.example.com/api/docs` 가 **404 인가** (운영에서는 `SWAGGER_ENABLED=false` 여야 정상)
3. 웹에서 구글 로그인이 끝까지 도는가 (`redirect_uri_mismatch` 는 콘솔 등록 문자열 문제 — RUNNING.md §8)
4. Vercel → `dibs-api` → **Cron Jobs** 탭: 8개가 **200** 을 돌려주는가 (401 → `CRON_SECRET`, 404 → §4 메서드 문제)
5. 이벤트를 하나 만들어 경쟁률이 갱신되는가 (= `stats-refresh` 가 실제로 돌고 있는가)
6. DB 에 제약이 실제로 붙었는가
   ```sql
   SELECT count(*) FROM pg_constraint WHERE conname LIKE '%_chk';
   SELECT tgname FROM pg_trigger WHERE NOT tgisinternal;
   ```
   0건이면 마이그레이션이 끝까지 적용되지 않은 것이다.
