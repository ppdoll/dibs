# Dibs (딥스)

> 가고 싶던 그곳, 열리는 순간 먼저 찜하세요.

---

## 무엇을 만든 것인가

파트너 업체(B2B)가 예약 자리를 열고, 이용자(B2C)가 그 자리를 신청해 가져가는 **예약 오픈 플랫폼**이다.
역할은 셋 — 운영자(Admin) / 파트너(Partner) / 이용자(User). 파트너는 가입만으로는 아무것도 못 하고
운영자 승인을 받아야 시설과 이벤트를 올릴 수 있다. 운영자 계정은 셀프가입이 아예 불가능하고 시드로만 생긴다.

이벤트에는 **모드가 둘** 있다. **선착순 즉시확정(INSTANT)** 은 고정 금액이고 신청하는 순간 당락이 정해진다.
**금액 제안(BID)** 은 min~max 범위에서 원하는 금액을 적어 내고, 마감 후 순위(금액 내림차순 → 그 금액에 도달한
시각 오름차순)로 파트너가 최종 명단을 확정한다. 그리고 **신청 단계에서 정원을 막지 않는다** — 정원 초과를
설계상 허용한다. 최종 선택이 마감 뒤에 이뤄지므로 신청 시점에 정원을 지킬 이유가 없고, 그 덕에 서버리스
다중 인스턴스에서 정원을 지키느라 필요한 분산 락·대기열 승계 로직이 통째로 사라졌다. 대신 기간 중 이용자에게
공개되는 정보는 **경쟁률뿐**이다 — 금액도, 커트라인도, 자기 순위도 보여주지 않는다.

왜 그렇게 정했는지는 [docs/DECISIONS.md](docs/DECISIONS.md)에 D-01~D-11로 정리돼 있다.

---

## 아키텍처 한눈에 보기

| 위치 | 무엇 | 핵심 |
|---|---|---|
| `apps/web` | Next.js 15 App Router + Tailwind + shadcn/ui | 44개 라우트. 이용자/파트너/운영자 화면이 한 앱 안에 세그먼트로 나뉜다. 경쟁률은 WebSocket 이 아니라 **폴링**한다(서버리스). |
| `apps/api` | NestJS 11 → Vercel 서버리스 함수 | 7개 모듈, 160개 엔드포인트. `api/index.ts` 가 진입점이고 Nest 앱을 모듈 스코프에 캐시해 콜드스타트를 한 번만 치른다. |
| `packages/shared` | 타입 · zod 스키마 · 순위/금액/기간 계산 | 순위 규칙(`ranking.ts`)이 프론트와 백엔드에 두 벌 존재하지 않게 한 곳에만 둔다. 여기를 바꾸면 양쪽이 함께 바뀐다. |
| `apps/api/prisma` | 30개 모델 + 마이그레이션 | `schema.prisma` 는 **모양**을, `migrations/…_constraints` 는 **의미**(CHECK · 부분 유니크 · 트리거)를 지킨다. 둘 다 `prisma migrate deploy` 한 번에 올라간다. |

---

## 빠른 시작

```bash
pnpm install

# .env 는 각 앱 디렉터리에 놓는다. 루트에 두면 아무도 읽지 않는다.
cp .env.example apps/api/.env    # 최소 DATABASE_URL / DIRECT_URL / GOOGLE_* / JWT_SECRET 를 채운다
echo 'NEXT_PUBLIC_API_URL="http://localhost:3001"' > apps/web/.env.local

pnpm --filter @dibs/api exec prisma migrate dev --name init
pnpm --filter @dibs/api db:seed

pnpm dev                         # web :3000 / api :3001
```

- 웹 http://localhost:3000
- API 문서(Swagger) http://localhost:3001/api/docs

> 제약(CHECK · 부분 유니크 · 트리거)은 마이그레이션에 포함되어 있다. 따로 적용할 단계는 없다.

전체 절차 — 환경변수 하나하나, 구글 OAuth 설정, 시나리오별 손테스트, 크론을 손으로 때리는 법,
트러블슈팅 — 은 **[docs/RUNNING.md](docs/RUNNING.md)** 에 있다.

---

## 주요 화면 경로

**이용자**

| 경로 | 화면 |
|---|---|
| `/` | 홈 피드 (마감임박 · 신규 오픈 · 인기 · 카테고리) |
| `/search` | 이벤트/시설 검색 |
| `/events/[eventId]` | 이벤트 상세 · 신청 · 금액 상향 |
| `/venues/[venueId]` | 시설 상세 |
| `/my`, `/my/applications`, `/my/applications/[id]`, `/my/profile` | 내 신청 · 프로필 |
| `/notifications` | 알림 · 쪽지 |
| `/auth/login`, `/auth/callback` | 구글 로그인 시작 / 토큰 수령 |

**파트너**

| 경로 | 화면 |
|---|---|
| `/partner/apply` | 파트너 신청서 제출 (운영자 승인 대기) |
| `/partner`, `/partner/profile` | 대시보드 · 심사 상태 |
| `/partner/businesses`, `/partner/businesses/new` | 사업자 등록 |
| `/partner/venues`, `/partner/venues/new`, `/partner/venues/[venueId]`, `.../images` | 시설 등록 · 심사 요청 · 이미지 |
| `/partner/events`, `/partner/events/new`, `/partner/events/[eventId]` | 이벤트 등록 · 게시 |
| `/partner/events/[eventId]/applicants` | 진행 중 신청자 (금액 + **잠정** 순위) |
| `/partner/events/[eventId]/selection` | 마감 후 순위 리스트 · 최종 명단 확정 |
| `/partner/events/[eventId]/messages` | 자기 이벤트 신청자에게 쪽지 |

**운영자**

| 경로 | 화면 |
|---|---|
| `/admin` | 대시보드 (심사 대기 · 임박 홀드 · 지연 파트너) |
| `/admin/partners`, `/admin/businesses`, `/admin/venues` | 승인 큐 3종 |
| `/admin/events`, `/admin/events/[eventId]` | 이벤트 운영 (강제 마감 · 정지 · 마감 연장) |
| `/admin/users`, `/admin/users/[userId]` | 계정 정지 · 역할 |
| `/admin/broadcasts`, `/admin/broadcasts/new` | 세그먼트 공지 |
| `/admin/settings` | 런타임 설정 (`SETTLEMENT_ENABLED` 등 DB 기반 플래그) |
| `/admin/audit-logs`, `/admin/audit` | 감사 로그 · 체인 무결성 검사 |

---

## 문서 안내

| 문서 | 무엇이 들어 있나 | 언제 보나 |
|---|---|---|
| [docs/DECISIONS.md](docs/DECISIONS.md) | 제품 결정 D-01~D-11 과 **왜 그렇게 정했는지** | "이건 왜 이렇게 동작하지?" 싶을 때. 기능을 바꾸기 전에 먼저 본다. |
| [docs/IMPLEMENTATION-CONSTRAINTS.md](docs/IMPLEMENTATION-CONSTRAINTS.md) | 코드가 반드시 지켜야 하는 32개 IC 규칙 | 서비스 코드를 고칠 때. 조건부 UPDATE 의 WHERE 절에서 조건 하나만 빼도 규칙이 무효가 된다. |
| [docs/API-ROUTES.md](docs/API-ROUTES.md) | 160개 엔드포인트 전체 목록 (메서드 · 경로 · 권한) | 프론트에서 부를 API 를 찾을 때. 실행 중이면 `/api/docs` 가 더 정확하다. |
| [docs/RUNNING.md](docs/RUNNING.md) | 로컬 구동 · 손테스트 시나리오 · 크론 수동 실행 · 트러블슈팅 | 처음 돌릴 때, 그리고 뭔가 안 될 때. |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Vercel 2-프로젝트 구성 · 환경변수 · 크론 · 배포 순서 | 배포할 때. |

---

## 명령어

| 명령 | 하는 일 |
|---|---|
| `pnpm dev` | 웹 + API 동시 실행 |
| `pnpm build` | 전체 빌드 |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` | 타입 검사 / 린트 / 테스트 |
| `pnpm --filter @dibs/api exec prisma migrate dev` | 마이그레이션 생성·적용 |
| `pnpm --filter @dibs/api db:seed` | 시드 데이터 (운영자 계정 포함) |
| `pnpm --filter @dibs/api db:studio` | Prisma Studio |

---

## 현재 범위 밖인 것

솔직하게 적어둔다. 아래 셋은 **자리만 잡혀 있고 실제로 동작하지 않는다.**

- **실결제(PG)** — 예약금은 상태·타이머·테이블 구조만 있다. `DEPOSIT_HOLD_ENABLED` 는 기본 `false` 이고,
  켜도 돈이 오가지 않는다. 포트원/토스페이먼츠 중 어느 쪽을 붙일지도 아직 정하지 않았다(D-05).
- **카카오 알림톡 · SMS** — 알림 채널은 앱 내 쪽지 + 이메일(Resend) 둘뿐이다(D-10).
- **정산 집행** — 수수료 정책과 정산 테이블은 있고 계산도 하지만, `SETTLEMENT_ENABLED` 가 꺼져 있으면
  계산조차 하지 않는다. **실제 이체는 어떤 경로로도 일어나지 않는다.**

그 밖에 개인정보처리방침·이용약관은 아직 없다. 실서비스 전에 반드시 필요하다.
