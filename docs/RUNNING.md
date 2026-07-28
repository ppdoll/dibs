# Dibs — 로컬에서 돌리고 손으로 테스트하기

> 이 문서 하나만 위에서 아래로 따라가면 로컬에서 전 기능이 돈다.
> 소스를 읽을 필요는 없다. 제품 규칙이 궁금하면 [DECISIONS.md](DECISIONS.md), 배포는 [DEPLOY.md](DEPLOY.md).

---

## ⚡ VS Code 로 쓴다면 — 여기만 보면 된다

아래 3·4·5장을 손으로 따라 하는 대신, VS Code 가 대신 해 준다.

**1) 설치 + env (한 번만)**

`Ctrl+Shift+P` → `Tasks: Run Task` → **`① 설치 + env 준비`**

`pnpm install` 과 `apps/api/.env`·`apps/web/.env.local` 을 만들고, DB 준비 방법을 출력한다.

**2) Postgres 마련하기 — Docker 는 선택이다**

이 프로젝트가 요구하는 건 **Postgres 14+ 와 `pg_trgm`·`pgcrypto`** 뿐이다. 어디에 있든 상관없다.

| 방법 | 언제 |
|---|---|
| **WSL(Ubuntu) 안에 설치** | 이미 WSL 을 쓰고 있다면. 새 배포판이 생기지 않는다 |
| **Neon 클라우드** | 아무것도 설치하기 싫을 때. 운영 환경과 같은 물건이다 |
| **윈도우 네이티브** | WSL·Docker 를 아예 안 건드리고 싶을 때 |
| Docker Compose | Docker 를 이미 편하게 쓰고 있다면 (`[선택] Postgres 띄우기`, 포트 5433) |

> **Docker Desktop 은 권장하지 않는다.** `docker-desktop` WSL 배포판을 새로 만들고
> 기본 배포판·네트워킹·메모리 배분을 건드려서, 이미 쓰던 WSL 환경이 깨지는 일이 잦다.

각 방법의 정확한 명령은 `Tasks: Run Task` → **`DB 설치 방법 보기`** 가 출력해 준다
(아무것도 실행하지 않고 안내만 한다).

Postgres 를 마련하고 `apps/api/.env` 의 `DATABASE_URL`·`DIRECT_URL` 을 맞췄으면:

`Tasks: Run Task` → **`② DB 세팅 (연결 확인 → 마이그레이션 → 제약 → 시드)`**

`DB 연결 확인` 이 먼저 붙어 보고 확장이 없으면 대신 깔아 준다. 순서가 중요한 이유는 3장에 있다.

**3) 실행**

`F5` → **`🚀 전체 (API + Web)`**

API(3001)와 웹(3000)이 함께 뜨고, **양쪽 모두 중단점이 걸린다.**
서버 컴포넌트와 NestJS 서비스 안에서도 그대로 멈춘다.

**4) 로그인 — 구글 설정 없이**

`Tasks: Run Task` → **`개발용 토큰 발급`** → 계정 선택

출력된 한 줄을 브라우저 콘솔에 붙여 넣으면 그 계정으로 로그인된다.
구글 자격증명이 없어도 API 는 정상 부팅하고, `/auth/google` 만 안내 메시지와 함께 닫힌다.

| 계정 | 용도 |
|---|---|
| `admin@dibs.local` | 운영자 — 파트너 승인, 모더레이션, 공지 |
| `partner@dibs.demo` | 파트너 — 시설·이벤트 등록, 신청자 확인, 당첨자 확정 |
| `u1@dibs.demo` ~ `u8@dibs.demo` | 이용자 — 탐색, 신청, 내 내역 |

**5) 시간을 앞으로 감기**

로컬에는 크론이 없다. 예약금 만료·순위 확정·메일 발송은 크론이 진행시키므로,
기다려도 아무 일도 일어나지 않는다.

`Tasks: Run Task` → **`크론 전부 한 번씩 때리기`**

무엇이 실제로 바뀌었는지 항목별로 찍어 준다.

**그 밖의 태스크** — `DB 초기화 후 다시 세팅`, `Prisma Studio`, `타입체크 (전체)`,
`단위 테스트 (전체)`, `API 라우트 문서 갱신`

> 디버그 구성 중 `API (NestJS)` 가 `tsx` 대신 `nest start --debug` 를 쓰는 이유는
> [.vscode/launch.json](../.vscode/launch.json) 맨 위 주석에 적어 두었다 (요약: tsx 는
> `emitDecoratorMetadata` 를 만들지 않아 Nest 의 생성자 주입이 부팅에 실패한다).

아래는 VS Code 없이, 혹은 무슨 일이 일어나는지 알고 싶을 때 보는 전체 절차다.

---

## 0. 준비물

| 필요한 것 | 버전 | 확인 |
|---|---|---|
| Node.js | **20 이상** | `node -v` |
| pnpm | **9.x** (`pnpm@9.15.9` 로 고정돼 있다) | `pnpm -v` — 없으면 `corepack enable && corepack prepare pnpm@9.15.9 --activate` |
| PostgreSQL | **14 이상** (16 권장) | 아래 둘 중 하나 |
| `psql` | 선택 — 제약 SQL 적용에 쓴다 | `psql --version` (없으면 3-2의 대안 사용) |
| 구글 계정 | **2~3개** | 이용자 / 파트너 / 운영자를 나눠 쓴다 |

### Postgres — 로컬 Docker

```bash
docker run --name dibs-pg \
  -e POSTGRES_USER=dibs -e POSTGRES_PASSWORD=dibs -e POSTGRES_DB=dibs \
  -p 5432:5432 -d postgres:16
```

PowerShell 에서는 줄바꿈 `\` 대신 backtick(`` ` ``)을 쓰거나 한 줄로 붙여 쓴다.

이 경우 접속 문자열은 둘 다 같다(로컬에는 풀러가 없다):

```
DATABASE_URL="postgresql://dibs:dibs@localhost:5432/dibs?schema=public"
DIRECT_URL="postgresql://dibs:dibs@localhost:5432/dibs?schema=public"
```

### Postgres — Neon / Vercel Postgres

Neon 대시보드 → Connection string. **두 개를 따로 복사해야 한다.**

- **Pooled** (호스트에 `-pooler` 가 붙어 있다) → `DATABASE_URL`
- **Direct** (`-pooler` 없음) → `DIRECT_URL`

```
DATABASE_URL="postgresql://user:pw@ep-xxx-pooler.ap-southeast-1.aws.neon.tech/dibs?sslmode=require&pgbouncer=true&connection_limit=1"
DIRECT_URL="postgresql://user:pw@ep-xxx.ap-southeast-1.aws.neon.tech/dibs?sslmode=require"
```

둘을 바꿔 넣으면 마이그레이션이 이상한 방식으로 실패한다(§8 참고).
**마이그레이션과 DDL 은 pgbouncer 를 통과할 수 없다.**

---

## 1. 설치

```bash
pnpm install
```

워크스페이스 3개(`apps/web`, `apps/api`, `packages/shared`)를 한 번에 설치한다.

---

## 2. 환경변수

**`.env` 는 저장소 루트가 아니라 각 앱 디렉터리에 놓는다.**
NestJS 의 `ConfigModule` 과 Prisma CLI 는 프로세스의 cwd(= `apps/api`)에서 `.env` 를 찾고,
Next.js 는 `apps/web/.env.local` 을 읽는다. **루트 `.env` 는 어느 쪽도 보지 않는다** — 조용히 무시된다.

```bash
cp .env.example apps/api/.env
echo 'NEXT_PUBLIC_API_URL="http://localhost:3001"' > apps/web/.env.local
```

```powershell
Copy-Item .env.example apps\api\.env
'NEXT_PUBLIC_API_URL="http://localhost:3001"' | Out-File -Encoding utf8 apps\web\.env.local
```

웹에 필요한 값은 `NEXT_PUBLIC_API_URL` 하나뿐이다. DB 주소나 시크릿을 `apps/web` 쪽에 복사하지 않는다.

`.env.example` 에 변수마다 `[필수] / [선택] / [보안]` 표시와 값을 어디서 얻는지 적어 두었다.
여기서는 요약만 한다.

| 변수 | 어디서 얻나 | 개발 중 |
|---|---|---|
| `DATABASE_URL` | 위 §0 | **필수** |
| `DIRECT_URL` | 위 §0 | **필수** (마이그레이션·제약 SQL 이 이걸 쓴다) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | §2-1 | **필수** — 없으면 API 가 부팅하다 죽는다 |
| `GOOGLE_CALLBACK_URL` | `http://localhost:3001/api/auth/google/callback` | **필수** |
| `JWT_SECRET` | 아무 랜덤 문자열, **16자 이상** | **필수** |
| `WEB_APP_URL` | `http://localhost:3000` | **필수** |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` | **필수** (프론트가 API 를 못 찾는다) |
| `CRON_SECRET` | 아무 랜덤 문자열, **16자 이상** | 크론을 손으로 때리려면 필수 (§7) |
| `RESEND_API_KEY` / `EMAIL_FROM` | resend.com | 선택 — 없으면 아웃박스에 쌓이고 발송만 안 된다 |
| `RESEND_WEBHOOK_SECRET` | Resend → Webhooks | 선택 — 비면 웹훅을 401 로 막는다 |
| `BLOB_READ_WRITE_TOKEN` | Vercel → Storage → Blob | 선택 — 없으면 이미지 업로드만 실패 |
| `IP_HASH_SALT` | 아무 랜덤 문자열 | 선택 — 비면 `JWT_SECRET` 을 대신 쓴다 |
| `DEPOSIT_HOLD_ENABLED` | `false` 유지 | 선택 (실결제는 범위 밖) |
| `SWAGGER_ENABLED` | `true` | 선택 — `"false"` 일 때만 꺼진다 |
| `ADMIN_SEED_EMAIL` | 운영자로 쓸 **구글 이메일** | 선택 — §4 참고 |

> API 는 부팅할 때 `apps/api/src/config/env.schema.ts` 로 환경변수를 검증한다.
> 빠진 값이 있으면 런타임 500 이 아니라 **부팅 시점에 즉시 터진다.** 그게 의도다.

### 2-1. 구글 OAuth 설정

앱이 구글에서 받는 것은 **이메일과 프로필 이름/사진뿐**이다. 캘린더도 드라이브도 안 건드린다.
민감(sensitive) 범위를 쓰지 않으므로 **구글 심사(verification)를 받을 필요가 없다.**

1. [Google Cloud Console](https://console.cloud.google.com/) → 프로젝트 생성 (이름 아무거나, 예: `dibs-local`)

2. **API 및 서비스 → OAuth 동의 화면**
   - User Type: **외부(External)**
   - 앱 이름 `Dibs`, 사용자 지원 이메일 / 개발자 연락처 이메일: 본인 주소
   - **범위(Scopes)** — 딱 이 셋만 추가한다:
     - `openid`
     - `.../auth/userinfo.email`
     - `.../auth/userinfo.profile`
   - **테스트 사용자**: 앱이 "테스트" 상태인 동안에는 여기 등록된 계정만 로그인된다.
     **테스트에 쓸 구글 계정 2~3개를 전부 여기 추가한다.** 안 하면 `403: access_denied` 를 본다.

3. **API 및 서비스 → 사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID**
   - 애플리케이션 유형: **웹 애플리케이션**
   - 승인된 자바스크립트 원본:
     ```
     http://localhost:3000
     http://localhost:3001
     ```
   - 승인된 리디렉션 URI — **정확히 이 문자열 하나**:
     ```
     http://localhost:3001/api/auth/google/callback
     ```
     > `/auth/...` 가 아니라 `/api/auth/...` 다. NestJS 전역 prefix 가 `api` 라서 그렇다.
     > 여기서 한 글자라도 다르면 로그인 시 `redirect_uri_mismatch` 가 뜬다(§8).

4. 발급된 **클라이언트 ID / 보안 비밀번호**를 `.env` 의 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` 에 넣는다.

---

## 3. 데이터베이스 올리기 — **순서가 중요하다**

### 3-1. 스키마 마이그레이션

```bash
pnpm --filter @dibs/api exec prisma migrate dev --name init
```

30개 테이블과 인덱스가 생긴다. (`prisma generate` 는 이 명령이 자동으로 함께 돈다.)

### 3-2. 제약 SQL 적용 — **건너뛰지 말 것**

```bash
```

PowerShell:

```powershell
```

> `$DIRECT_URL` 이 셸에 없으면 `.env` 의 값을 큰따옴표로 감싸 그대로 붙여 넣으면 된다.

**왜 이게 따로 있나.** `schema.prisma` 는 테이블의 *모양*만 표현할 수 있다.
CHECK 제약, 조건이 붙은 부분(partial) 유니크, BEFORE UPDATE 트리거, EXCLUDE 제약은
Prisma DSL 에 문법 자체가 없다. 그런데 이 제품의 핵심 불변식이 정확히 그 형태다:

- 열린 예약금 홀드는 신청당 하나뿐이다 → `status='PENDING'` 조건이 붙은 **부분 유니크**
- 확정된 순위 스냅샷은 나중에 못 고친다 → **BEFORE UPDATE 트리거**
- 소프트 삭제된 시설이 slug 를 영구 점유하면 안 된다 → `deletedAt IS NULL` **부분 유니크**
- `amountStep >= 1`, `min <= max`, 소프트클로즈 설정 조합 등 → **CHECK**

**이 파일을 적용하지 않아도 앱은 정상적으로 뜨고 화면도 다 돈다.** 그래서 위험하다.
깨지는 건 지금이 아니라 나중에 — 리플레이된 웹훅 하나, 핫픽스 raw 쿼리 하나가 들어왔을 때다.
D-04(순위)·D-05(예약금)·D-06(상향 전용)·D-07(비공개)이 그때 조용히 무너진다.

이 파일은 **전부 멱등(idempotent)** 이다. 여러 번 돌려도 안전하고,
**`prisma migrate` 를 돌릴 때마다 다시 돌려야 한다** — Prisma 는 자기가 모르는 객체를 다음 migrate 에서
DROP 하는 마이그레이션으로 만들어 내기 때문이다.

#### psql 이 없다면 — Prisma 폴백

```bash
pnpm --filter @dibs/api exec prisma db execute \
  --url "$DIRECT_URL" \
```

`--url` 을 빼면 datasource 의 `url`(= 풀링 주소)을 쓰게 되고, pgbouncer 뒤에서는 DDL 이 실패한다.
로컬 Docker Postgres 처럼 풀러가 없으면 `--schema prisma/schema.prisma` 로 대체해도 된다.

> 폴백의 한계: 이 파일에는 `$fn$ ... $fn$` 형태의 달러 인용 함수 본문과 `DO` 블록이 들어 있다.
> `prisma db execute` 가 이를 잘라 먹고 문법 오류를 내면, 그때는 psql 을 설치하는 것 외에 방법이 없다.

#### 적용됐는지 확인

```sql
SELECT count(*) FROM pg_constraint WHERE conname LIKE '%_chk';
SELECT tgname FROM pg_trigger WHERE NOT tgisinternal;
```

CHECK 이 0건이면 적용되지 않은 것이다.

### 3-3. 시드

```bash
pnpm --filter @dibs/api db:seed
```

업종 분류·지역 코드 같은 참조 데이터와 운영자 계정 자리를 만든다.

---

## 4. 운영자 계정 만들기 (셀프가입 불가 — D-09)

운영자는 가입 화면이 없다. 셋 중 하나로 만든다.

**(a) 시드로** — `.env` 의 `ADMIN_SEED_EMAIL` 에 운영자로 쓸 **구글 이메일**을 적고 `db:seed` 를 돌린다.
그 주소로 구글 로그인하면 그 계정이 `ADMIN` 이 된다.

**(b) SQL 로** — 이미 한 번 로그인해 `User` 행이 생긴 뒤:

```sql
UPDATE "User"
   SET roles = ARRAY['USER','ADMIN']::"UserRole"[]
 WHERE email = '내구글주소@gmail.com';
```

**(c) Prisma Studio 로** — `pnpm --filter @dibs/api db:studio` → `User` → `roles` 에 `ADMIN` 추가.

> 역할을 바꾼 뒤에는 **로그아웃하고 다시 로그인**한다. 프론트가 캐시한 `/api/auth/me` 를 확실히 갱신하기 위해서다.

---

## 5. 실행

```bash
pnpm dev
```

| | 주소 |
|---|---|
| 웹 | http://localhost:3000 |
| API | http://localhost:3001 |
| **Swagger** | **http://localhost:3001/api/docs** |
| 헬스체크 | http://localhost:3001/health (전역 prefix `api` 의 유일한 예외) |

> `/health` 는 `@Public()` 이 붙어 있지 않아서 전역 JWT 가드에 걸린다. 토큰 없이 열면 **401** 이 온다.
> 401 이 왔다는 것은 라우팅과 부팅이 성공했다는 뜻이므로 "살아 있는지"만 보는 용도로는 그대로 쓸 수 있다.
> DB 상태(`{"status":"ok","db":"ok"}`)까지 보려면 로그인 토큰을 붙이거나 컨트롤러에 `@Public()` 을 붙여야 한다.

Swagger 에서 인증이 필요한 엔드포인트를 때리려면: 브라우저에서 로그인한 뒤
개발자도구 콘솔에 `localStorage.getItem('dibs.accessToken')` 을 쳐서 토큰을 꺼내고,
Swagger 우측 상단 **Authorize** 에 붙여 넣는다.

---

## 6. 시나리오별 손테스트 — 처음부터 끝까지

브라우저 프로필(또는 시크릿 창)을 **3개** 띄워 놓고 계정을 섞지 않는 게 가장 편하다.
편의상 아래처럼 부른다: **A = 운영자**, **B = 파트너**, **C = 이용자**.

> 시간이 걸리는 전이(마감, 순위 확정 등)는 기다리지 말고 **§7 의 크론을 손으로 때린다.**

---

### ⓪ (사전) 이용자 C 의 휴대폰 인증 플래그 세우기 — **거의 반드시 걸린다**

신청 API 는 `User.phoneVerifiedAt IS NOT NULL` 을 요구한다(IC-18).
구글 가입은 무제한이라 미인증 계정 3개면 자리 3개를 먹기 때문이다.
그런데 **휴대폰 인증 화면/엔드포인트는 아직 없다.** 그래서 손으로 세워 준다.

C 로 한 번 로그인해 `User` 행이 생긴 뒤:

```sql
UPDATE "User"
   SET phone = '01012345678', "phoneVerifiedAt" = now()
 WHERE email = 'C의구글주소@gmail.com';
```

안 하면 신청 시 **403 `PHONE_VERIFICATION_REQUIRED`** 가 뜬다. 화면이 고장 난 게 아니다.

---

### ① 구글 로그인

- **URL**: http://localhost:3000/auth/login
- 가입 의사(일반 이용자 / 파트너)를 고르고 구글 버튼을 누른다.
- 구글 동의 화면 → `http://localhost:3001/api/auth/google/callback` → `http://localhost:3000/auth/callback?token=...`
  로 되돌아온다. 프론트가 토큰을 localStorage(`dibs.accessToken`)에 넣고 URL 에서 지운다.
- **보이는 것**: 헤더에 프로필 이름/사진. `/my` 에 내 정보.
- A, B, C 각각 한 번씩 로그인해 둔다. **B 는 "파트너"를 골라 로그인한다** — 그래야 빈 파트너 신청서가
  `DRAFT` 로 미리 만들어진다.

### ② 파트너 신청 (B)

- **URL**: http://localhost:3000/partner/apply
- 담당자명·연락처·소개 등을 적고 제출 → `POST /api/auth/partner-application`
- **보이는 것**: `/partner/profile` 에 **심사 대기(PENDING)** 상태와 제출 시각.
  `/partner/venues` 같은 화면은 아직 막혀 있다 — 승인 전에는 아무것도 못 한다(D-09).

### ③ 파트너 승인 (A, 운영자)

- **URL**: http://localhost:3000/admin/partners
- **보이는 것**: 심사 큐. 기본 정렬은 `PENDING` + SLA 마감 오름차순.
- B 의 신청서를 열어(`/admin/partners/[id]`) **승인**. 반려·보완요청 버튼도 여기 있다.
- **결과**: B 의 `/partner/profile` 이 **승인됨**으로 바뀌고, B 에게 앱 내 알림이 하나 생긴다.
  (알림 확인은 ⑨에서 몰아서 한다.)

### ④ 사업자 등록 → 확인 (B → A)

시설을 심사에 올리려면 **사업자가 먼저 VERIFIED 여야 한다.**

- B: **URL** http://localhost:3000/partner/businesses/new — 상호·사업자등록번호·대표자 등을 입력.
  (`BLOB_READ_WRITE_TOKEN` 이 있으면 사업자등록증도 업로드할 수 있다. 없으면 건너뛴다.)
- B: 사업자 상세에서 **심사 제출**.
- A: **URL** http://localhost:3000/admin/businesses → 해당 건을 열어 **확인 완료**.
- **보이는 것**: B 의 `/partner/businesses` 목록에서 상태가 `VERIFIED`.

### ⑤ 시설 등록 → 검수 (B → A)

- B: **URL** http://localhost:3000/partner/venues/new — 사업자를 고르고 시설명·주소·업종을 입력하면
  `DRAFT` 로 생성된다.
- B: 시설 상세(`/partner/venues/[venueId]`)에서 **심사 요청** → `DRAFT` → `PENDING_REVIEW`.
  - 여기서 **409 `BUSINESS_NOT_VERIFIED`** 가 나면 ④가 안 끝난 것이다.
- A: **URL** http://localhost:3000/admin/venues → **검수 승인** → 시설이 `ACTIVE`.
- **보이는 것**: 이용자 화면 http://localhost:3000/venues/[venueId] 가 이제 열린다.

### ⑥ 이벤트 등록 · 공개 (B)

- **URL**: http://localhost:3000/partner/events/new
- 고를 것:
  - **모드**: `INSTANT`(선착순 즉시확정, 고정 금액) 또는 `BID`(금액 제안).
    **처음 테스트라면 `BID` 를 고른다** — 순위·선정 흐름을 봐야 재미있다.
  - **정원(capacity)**: 작게. `2` 정도.
  - **신청 기간**: 시작은 **지금**, 마감은 **5~10분 뒤**. 마감이 이미 지났으면 공개가 거부된다.
  - **금액**: `minAmount` / `maxAmount` / `amountStep`.
  - **예약금**: `depositRequired` 는 **끄고** 시작하는 걸 권한다. 켜면 신청이 곧바로 유효해지지 않고
    `PENDING_DEPOSIT` 에서 멈춘다(실결제가 없으므로 §7 의 `deposit/confirm` 을 손으로 불러야 한다).
- 저장하면 항상 `DRAFT` 다. 상세에서 **공개(publish)** 를 눌러야 `SCHEDULED`(또는 시작 시각이 지났으면 곧바로 `OPEN`).
- **보이는 것**: 이용자 홈 http://localhost:3000/ 과 검색 `/search` 에 이벤트가 뜬다.
  - 안 뜨면: 시설이 `ACTIVE` 가 아니거나(⑤), 아직 `SCHEDULED` 다 → §7 의 `events/lifecycle` 을 한 번 때린다.

### ⑦ 신청 (C, 이용자)

- **URL**: http://localhost:3000/events/[eventId]
- **보이는 것**: 남은 시간, 그리고 **경쟁률뿐이다** — `정원 2명 / 신청 5명 (2.5:1)`.
  금액도, 커트라인도, 내 순위도 화면 어디에도 없다. **그게 버그가 아니라 D-07 이다.**
- 금액을 적고 신청 → `POST /api/applications`
  - `BID` 면 정원이 차 있어도 계속 받는다. **정원 초과는 설계상 허용이다**(D-03).
  - `INSTANT` 면 정원이 차는 순간 마감된다.
- 금액 **상향**도 같은 화면에서 한다. **내리는 것은 불가능하다**(D-06).
  올릴 때마다 `lastBidAt` 이 갱신되므로 동점 시 불리해진다(D-04).
- 신청 여러 건을 만들려면 계정을 바꿔야 한다 — 한 계정은 한 이벤트에 한 번만 신청할 수 있다.
  빠르게 여러 건이 필요하면 Swagger 에서 다른 계정 토큰으로 `POST /api/applications` 를 반복한다.
- **보이는 것**: http://localhost:3000/my/applications 에 내 신청과 **내가 적어낸 금액**(본인 것은 공개).

> **경쟁률이 계속 0으로 보인다면** 정상이다. `liveApplicantCount` 는 크론이 갱신한다 —
> §7 의 `events/stats-refresh` 를 한 번 때리면 즉시 반영된다.

### ⑧ 파트너가 신청자 확인 → 마감 → 당첨자 확정 (B)

**(a) 진행 중 신청자 보기**

- **URL**: http://localhost:3000/partner/events/[eventId]/applicants
- **보이는 것**: 신청자 목록 + **금액** + **잠정 순위**. 파트너는 자기 이벤트의 숫자를 전부 본다.
  "잠정"인 이유는 마감 전이고 예약금 미납 건이 아직 빠질 수 있어서다.

**(b) 마감**

기다리지 않고 셋 중 하나로 마감시킨다.

1. 이벤트 상세에서 **조기 마감** (`OPEN` → `CLOSED`). 신규 신청만 막고, 이미 도는 예약금 시계는 건드리지 않는다.
2. 운영자(A) `/admin/events/[eventId]` 에서 **강제 마감**.
3. 마감 시각이 지나기를 기다렸다가 §7 의 `events/lifecycle` 을 때린다.

**(c) 순위 확정 → 선정 라운드 개시**

- 순위는 마감 즉시가 아니라 **마감 + 예약금 윈도우 + 1분** 이 지나야 얼어붙는다(D-04, `rankingLockAt`).
  마감 1분 전에 신청한 사람도 예약금 10분을 온전히 써야 하기 때문이다.
- §7 의 `expire-holds` → `finalize-rankings` 순서로 때린다. **순서를 지켜야 한다** —
  열린 홀드가 하나라도 남아 있으면 확정 게이트가 막는다(IC-26).
- 급하면 파트너 화면 `/partner/events/[eventId]/selection` 의 **라운드 열기** 버튼으로 강제 개시할 수 있다.

**(d) 최종 명단 확정**

- **URL**: http://localhost:3000/partner/events/[eventId]/selection
- **보이는 것**: `ROW_NUMBER()` 로 계산된 순위표 — 금액 내림차순 → 그 금액에 도달한 시각 오름차순 →
  신청 일련번호. 정원선(`withinCapacity`)과 **커트라인**이 함께 보인다. 이 숫자들은 파트너 화면 밖으로 절대 안 나간다.
- 할 수 있는 것: **자동 예비선정**, 순위 밖 후보 **수동 추가**, **제외**, 결원 **승계**, CSV 내려받기.
- **명단 확정(finalize)** 을 누르면 되돌릴 수 없다. 이벤트가 `FINALIZED` 가 되고 선정/미선정 알림이 만들어진다.

### ⑨ 알림 확인

- **이용자 C**: http://localhost:3000/notifications — 신청 완료, 선정/미선정 알림.
  헤더의 미열람 배지는 `/api/notifications/unread-count` 가 채운다.
- **파트너 B**: 파트너 승인/반려, 시설 검수 결과 알림.
- **파트너 → 신청자 쪽지**: http://localhost:3000/partner/events/[eventId]/messages
  에서 자기 이벤트 신청자에게만, 상태별 필터로 보낼 수 있다.
- **운영자 → 세그먼트 공지**: http://localhost:3000/admin/broadcasts/new
  (전체 유저 / 전체 파트너 / 특정 이벤트 신청자). 발송은 크론이 펼친다 →
  §7 의 `notifications/expand-broadcasts` → `notifications/dispatch`.
- **이메일**: `RESEND_API_KEY` 가 없으면 `EmailDelivery` 테이블에 `PENDING` 으로 쌓이기만 한다.
  Prisma Studio 로 그 행들을 보면 "무엇이 발송될 뻔했는지" 확인할 수 있다. 앱 내 알림은 정상 동작한다.
- 알림 문구에는 **타인의 금액·커트라인·본인 순위가 절대 들어가지 않는다**(IC-44). 새 알림을 만들 때도 이 선을 지킨다.

---

## 7. 크론을 손으로 때리기

서버리스라 상주 프로세스가 없다. "10분 뒤 만료", "마감되면 확정" 같은 시간 기반 전이는 전부
크론이 지나가며 따라잡는다. 테스터는 실제 시간이 흐르기를 기다릴 수 없으므로 **직접 호출한다.**

전부 `POST` 이고 `Authorization: Bearer $CRON_SECRET` 이 필요하다.
`CRON_SECRET` 이 비어 있으면 `CronGuard` 가 **전부 401 로 거절한다** — 열어주느니 막는다(fail closed).

```bash
# bash
export CRON_SECRET="dev-only-cron-secret-32chars-min"   # .env 와 같은 값
hit() { curl -s -X POST "http://localhost:3001$1" -H "Authorization: Bearer $CRON_SECRET"; echo; }

hit /api/cron/events/lifecycle
hit /api/cron/events/stats-refresh
hit /api/cron/expire-holds
hit /api/cron/deposit-reminders
hit /api/cron/finalize-rankings
hit /api/cron/notifications/expand-broadcasts
hit /api/cron/notifications/dispatch
hit /api/cron/notifications/sweep-expired
```

```powershell
# PowerShell
$h = @{ Authorization = "Bearer dev-only-cron-secret-32chars-min" }
function Hit($p) { Invoke-RestMethod -Method Post -Uri "http://localhost:3001$p" -Headers $h }

Hit /api/cron/events/lifecycle
Hit /api/cron/expire-holds
Hit /api/cron/finalize-rankings
```

### 라우트 전체

| 순서 | 라우트 | 하는 일 | 언제 때리나 |
|---|---|---|---|
| 1 | `POST /api/cron/events/lifecycle` | `SCHEDULED→OPEN`, `OPEN→CLOSED` 따라잡기 | 이벤트가 안 열릴 때 / 마감시켜야 할 때 |
| 2 | `POST /api/cron/events/stats-refresh` | 경쟁률 집계(`liveApplicantCount`) 갱신 + INSTANT `claimedCount` 실측 대사 | **경쟁률이 0으로 보일 때** |
| 3 | `POST /api/cron/expire-holds` | 만료된 예약금 홀드 스윕 — INSTANT 자리 반환 / 상향 부족분 금액 롤백 | 순위 확정 **직전에 반드시** |
| 4 | `POST /api/cron/deposit-reminders` | 만기 임박 예약금 리마인더 (홀드당 정확히 1회) | 알림 테스트용 |
| 5 | `POST /api/cron/finalize-rankings` | `rankingLockAt` 대사 + 확정 시각이 지난 이벤트의 선정 라운드 개시 | 마감 후 순위를 얼리고 싶을 때 |
| 6 | `POST /api/cron/notifications/expand-broadcasts` | 예약·확장 중인 공지의 다음 수신자 페이지를 펼친다 | 운영자 공지를 보낸 뒤 |
| 7 | `POST /api/cron/notifications/dispatch` | 이메일 아웃박스를 집어 Resend 로 발송 (`?limit=` 지원) | 6 다음에 |
| 8 | `POST /api/cron/notifications/sweep-expired` | 만료된 알림을 목록에서 내린다 (소프트 삭제) | 아무 때나 |

**순서 규칙 둘만 기억하면 된다.**

- `expire-holds` **→** `finalize-rankings`. 반대로 하면 열린 홀드 때문에 게이트에 걸려
  아무 이벤트도 확정되지 않는다(IC-26). 에러가 아니라 조용히 0건이다.
- `expand-broadcasts` **→** `dispatch`. 반대로 하면 방금 펼친 수신자의 메일이 한 바퀴 밀린다.

전부 **at-least-once 전제**로 만들어져 있다. 같은 걸 두 번 때려도 두 번째는 0행이다.
겁내지 말고 여러 번 눌러도 된다.

### 예약금(디파짓)을 실제로 테스트하려면

실결제는 범위 밖이라 "돈을 냈다"는 신호를 만들 방법이 API 밖에 없다.
이벤트를 `depositRequired = true` 로 만들었다면 신청 후:

```
POST /api/applications/{applicationId}/deposit/confirm
Authorization: Bearer <이용자 토큰>
Idempotency-Key: <아무 UUID>
```

를 Swagger 에서 부르면 `PENDING_DEPOSIT` → (BID) `VALID` / (INSTANT) `CONFIRMED` 로 넘어간다.
부르지 않고 `expire-holds` 를 때리면 만료 흐름(자리 반환 / 금액 롤백)을 볼 수 있다.

> 상태를 바꾸는 엔드포인트는 대부분 `Idempotency-Key` 헤더를 요구한다(IC-03).
> 웹 화면은 자동으로 붙여 준다. Swagger/curl 로 직접 부를 때만 신경 쓰면 된다.

---

## 8. 트러블슈팅

### `P1001: Can't reach database server`

DB 에 TCP 로 닿지 못했다. 인증 실패가 아니라 **연결 자체가 안 된 것**이다.

- Docker: `docker ps` 로 `dibs-pg` 가 살아 있는지, `-p 5432:5432` 가 붙어 있는지 확인.
  죽었으면 `docker start dibs-pg`.
- Neon: 무료 플랜은 유휴 시 컴퓨트가 잠든다. 대시보드에서 한 번 깨우고 다시 시도.
  호스트명 오타, `sslmode=require` 누락도 흔하다.
- 회사망/VPN 이 5432 를 막는 경우가 있다.
- 빠른 확인: `psql "$DIRECT_URL" -c "select 1"`

### `P1012: Environment variable not found: DIRECT_URL`

`schema.prisma` 의 datasource 가 `env("DIRECT_URL")` 을 요구하는데 Prisma 가 그 값을 못 찾았다.

거의 항상 **`.env` 를 저장소 루트에 둔 것**이 원인이다. Prisma CLI 는 **cwd 의 `.env`** 와
`prisma/.env` 만 읽는다. `pnpm --filter @dibs/api exec ...` 는 cwd 를 `apps/api` 로 바꾸므로
`apps/api/.env` 가 있어야 한다.

- `cp .env.example apps/api/.env` 후 값을 채웠는지 확인한다 (§2).
- 변수 이름 오타, 따옴표 짝이 안 맞는 줄이 없는지 확인한다.
- 그래도 안 되면 셸에 직접 넣는다:
  `DIRECT_URL="postgresql://..." pnpm --filter @dibs/api exec prisma migrate dev`
  (PowerShell: `$env:DIRECT_URL="postgresql://..."` 를 먼저 실행)

### 로그인은 되는데 화면이 계속 로그인 페이지로 튄다 (401 루프)

`JWT_SECRET` 을 바꿨거나, 사용자의 `tokenVersion` 이 올라갔다.
발급된 토큰의 `tv` 가 DB 의 `tokenVersion` 과 다르면 전부 무효다 — 전체 로그아웃 기능이 그 원리로 동작한다.

**고치는 법**: 브라우저 콘솔에서

```js
localStorage.removeItem('dibs.accessToken'); location.href = '/auth/login';
```

`JWT_SECRET` 을 바꾼 뒤에는 **모든 테스트 계정이 한 번씩 다시 로그인해야 한다.**
`IP_HASH_SALT` 를 비워 뒀다면 `JWT_SECRET` 이 IP 해시 솔트로도 쓰이므로,
바꾸는 순간 과거 입찰 이력의 해시와 대조가 끊긴다는 점도 알아 둔다.

### 구글 `Error 400: redirect_uri_mismatch`

브라우저가 구글로 보낸 `redirect_uri` 와 구글 콘솔에 등록된 문자열이 **완전히 일치하지 않는다.**
부분 일치나 와일드카드는 없다.

체크리스트:
- `.env` 의 `GOOGLE_CALLBACK_URL` 과 콘솔의 "승인된 리디렉션 URI" 가 **글자 단위로** 같은가
- `/api/` 가 빠지지 않았는가 — `http://localhost:3001/api/auth/google/callback`
- 끝에 슬래시(`/`)를 하나 더 붙이지 않았는가
- `127.0.0.1` 과 `localhost` 를 섞어 쓰지 않았는가 (구글은 다른 값으로 본다)
- 포트가 3001 인가 (3000 은 웹이다)
- 콘솔에서 방금 바꿨다면 반영에 몇 분 걸릴 수 있다. `.env` 를 바꿨다면 **API 를 재시작**한다.

그리고 `403: access_denied` 는 다른 문제다 — OAuth 동의 화면이 "테스트" 상태인데
그 구글 계정이 **테스트 사용자 목록에 없는 것**이다.

### `prepared statement "s0" already exists` / pgbouncer 관련 오류

풀링(pgbouncer) 주소로 준비된 문장(prepared statement)을 쓰려다 난 오류다.
transaction 모드 풀러는 문장이 세션에 남는 것을 보장하지 않는다.

- 런타임(`DATABASE_URL`)에는 **반드시** `?pgbouncer=true` 를 붙인다. Prisma 가 준비된 문장을 끈다.
- `&connection_limit=1` 도 함께 권장한다. 서버리스 인스턴스마다 풀을 새로 만드는 것을 막는다.
- **마이그레이션은 풀러를 통과할 수 없다.** 반드시 `DIRECT_URL`(직결)로 실행한다.
  `prisma migrate` 에서 이 오류가 났다면 `DATABASE_URL` 과 `DIRECT_URL` 을 서로 바꿔 넣은 것이다.

### 신청 시 403 `PHONE_VERIFICATION_REQUIRED`

정상 동작이다. §6-⓪ 를 보고 `phoneVerifiedAt` 을 세워 준다.

### 이벤트를 공개하려는데 409 `VENUE_NOT_ACTIVE`

시설이 아직 심사 중이거나 반려됐다. §6-⑤ 로 돌아가 운영자가 시설을 승인해야 한다.

### 시설 심사 요청에서 409 `BUSINESS_NOT_VERIFIED`

사업자가 아직 `VERIFIED` 가 아니다. §6-④ 를 먼저 끝낸다.

### 크론이 401 만 돌려준다

`.env` 의 `CRON_SECRET` 이 비어 있거나(→ 무조건 401), 헤더 값이 다르다.
`Authorization: Bearer <값>` 형식이고 `Bearer` 뒤에 공백 하나다. `.env` 를 고쳤으면 API 를 재시작한다.

### 경쟁률·"남은 자리"가 갱신되지 않는다

`liveApplicantCount` / `competitionRatioX10` 은 신청 트랜잭션이 아니라 **크론이 갱신한다.**
`POST /api/cron/events/stats-refresh` 를 한 번 때리면 즉시 맞춰진다.

### `Prisma schema drift detected` / migrate 가 인덱스를 DROP 하려 한다

예전에 제약을 마이그레이션 밖에서 적용하던 시절의 증상이다.
지금은 제약이 마이그레이션 이력에 들어 있어 이 경고가 나오지 않는다.
운영에서는 CI 에 드리프트 가드를 건다:

```bash
pnpm --filter @dibs/api exec prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel  prisma/schema.prisma --exit-code
```

### 전부 꼬였을 때 — 초기화

```bash
pnpm --filter @dibs/api exec prisma migrate reset --force
pnpm --filter @dibs/api db:seed
```

`migrate reset` 은 **데이터를 전부 지운다.** 로컬에서만 쓴다.
