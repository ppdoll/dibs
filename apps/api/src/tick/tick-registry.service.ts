import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

/**
 * 틱 한 번에 실행되는 잡 하나.
 *
 * ★ 각 도메인 모듈이 **자기 잡을 자기가 등록한다.** 레지스트리는 도메인을 모른다.
 *   이 방향이라야 "모듈끼리 DI 로 직접 붙지 않는다"는 이 코드베이스의 규칙이 유지된다.
 *   (반대로 레지스트리가 6개 서비스를 주입하는 구조였다면 도메인 모듈 세 개를
 *   전부 `exports` 로 열어야 하고, 그 순간 스케줄러가 모든 도메인의 허브가 된다.)
 */
export interface TickJob {
  /** 로그와 응답에 찍히는 이름. 기존 크론 경로와 같게 둔다 — 장애 때 검색어가 하나로 유지된다. */
  readonly name: string;
  /**
   * 실행 순서. 작을수록 먼저.
   *
   * 순서가 **의미 있는** 유일한 쌍은 `expire-holds`(20) → `finalize-rankings`(30) 이다:
   * 열린 홀드가 하나라도 남아 있으면 확정 게이트가 그 이벤트를 통째로 건너뛴다(IC-26).
   * 나머지는 순서가 뒤집혀도 한 주기 밀릴 뿐 결과가 달라지지 않는다.
   */
  readonly order: number;
  run(): Promise<unknown>;
}

export interface TickJobResult {
  job: string;
  ok: boolean;
  ms: number;
  result?: unknown;
  error?: string;
}

export interface TickReport {
  trigger: 'request' | 'cron' | 'manual';
  ran: number;
  failed: number;
  ms: number;
  results: TickJobResult[];
}

/** 게이트 행의 PK. 잡별로 나누지 않는 이유는 `claim()` 주석 참고. */
const GATE_NAME = 'global';

/** 기본 틱 주기. Vercel Pro 의 분 단위 크론과 같은 체감을 목표로 한다. */
const DEFAULT_INTERVAL_SECONDS = 60;

/**
 * 같은 람다 인스턴스가 이 간격 안에 다시 게이트를 두드리지 않는다.
 *
 * 게이트 쿼리는 UPDATE 한 방이라 싸지만, 트래픽이 몰리면 "어차피 안 걸릴 쿼리"를
 * 요청마다 날리게 된다. 인스턴스 로컬 타이머로 대부분을 걸러낸다.
 * (인스턴스마다 따로 세므로 여러 람다가 동시에 두드려도 게이트가 한 번만 통과시킨다.)
 */
const PROBE_THROTTLE_MS = 10_000;

/**
 * 요청 경로에서 틱을 기다려 주는 최대 시간.
 *
 * 유휴 상태의 틱은 조건부 UPDATE 여덟 방이라 실측 16~26ms 다. 하지만 밀린 일이
 * 많으면 길어질 수 있고, 그 대가를 **하필 그때 들어온 사용자 한 명**이 치르게 둘 수는 없다.
 * 예산을 넘기면 응답을 먼저 보내고 틱은 그대로 진행시킨다(완주 여부는 보장하지 않는다 —
 * at-least-once 라 다음 틱이 따라잡는다).
 */
const AWAIT_BUDGET_MS = 5_000;

/**
 * 크론을 "시간"이 아니라 "트래픽"으로 굴리기 위한 레지스트리.
 *
 * ★ 왜 이런 게 필요한가 — Vercel Hobby 플랜은 크론을 **하루 1회, 2개**까지만 허용한다.
 *   원래 이 서비스는 8개를 매분 돌렸다. 개수는 하나로 합치면 되지만 **주기는 합쳐지지 않는다.**
 *   그래서 스케줄의 주 동력을 크론에서 요청으로 옮겼다:
 *
 *     - 요청이 들어올 때마다 "틱이 밀렸나?" 를 묻고, 밀렸으면 그 요청이 대신 굴린다.
 *     - 하루 1회 크론은 **트래픽이 완전히 없을 때를 위한 안전망**으로만 남긴다.
 *
 *   트래픽이 0이면 아무것도 안 돈다. 그래도 되는 이유는 만료 판정 자체가
 *   **조회 시점 지연 만료(lazy expiry)** 라 데이터 정합성이 깨지지 않기 때문이다.
 *   아무도 안 보고 있는 동안 밀리는 것은 알림 발송과 자리 반환 타이밍뿐이고,
 *   누군가 들어오는 순간 그 요청이 밀린 것을 전부 따라잡는다.
 */
@Injectable()
export class TickRegistry {
  private readonly logger = new Logger(TickRegistry.name);
  private readonly jobs: TickJob[] = [];

  /** 이 람다 인스턴스가 마지막으로 게이트를 두드린 시각(epoch ms). */
  private lastProbeAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  /** 도메인 모듈이 부팅 시점에 호출한다. 같은 이름은 덮어쓴다(핫리로드 중복 방지). */
  register(job: TickJob): void {
    const existing = this.jobs.findIndex((j) => j.name === job.name);

    if (existing === -1) {
      this.jobs.push(job);
    } else {
      this.jobs[existing] = job;
    }
  }

  get registered(): string[] {
    return this.sorted().map((j) => j.name);
  }

  /**
   * 요청 경로에서 호출된다. 틱이 밀렸을 때만 실제로 돈다.
   *
   * 반환이 `null` 이면 "지금은 돌 차례가 아니다" 라는 뜻이고, 이게 절대다수다.
   */
  async runIfDue(): Promise<TickReport | null> {
    const now = Date.now();
    if (now - this.lastProbeAt < PROBE_THROTTLE_MS) {
      return null;
    }
    this.lastProbeAt = now;

    if (!(await this.claim())) {
      return null;
    }

    return this.runAll('request');
  }

  /**
   * 게이트를 건너뛰고 무조건 돈다. 크론(안전망)과 운영자 수동 실행용.
   *
   * 게이트도 함께 밀어둔다 — 크론이 방금 다 돌려놨는데 다음 요청이 또 도는 것은 낭비다.
   */
  async runNow(trigger: 'cron' | 'manual'): Promise<TickReport> {
    await this.claim();
    return this.runAll(trigger);
  }

  /**
   * "지금 돌 차례인가" 를 묻고 동시에 예약해 버리는 원자적 한 방.
   *
   * ★ 잡별로 행을 나누지 않는 이유: 요청 경로에서 8행을 훑으면 그게 그대로 상시 비용이 된다.
   *   게이트는 하나만 두고, 통과했을 때 8개를 순서대로 다 돌린다. 개별 주기를 다르게
   *   가져갈 만큼 무거운 잡이 없다(전부 조건부 UPDATE 한두 방이다).
   *
   * INSERT … ON CONFLICT DO UPDATE … WHERE 로 쓴 이유는 "읽고 나서 쓰기" 를 없애기 위해서다.
   * 여러 람다가 같은 순간에 두드려도 UPDATE 가 성립하는 쪽은 정확히 하나다.
   */
  private async claim(): Promise<boolean> {
    const seconds = this.intervalSeconds();

    try {
      // $queryRaw 가 아니라 $executeRaw 다 — 영향 행 수가 곧 판정이고,
      // SELECT 가 아닌 문을 $queryRaw 로 보내면 역직렬화에서 터진다.
      const affected = await this.prisma.$executeRaw`
        INSERT INTO "CronTick" ("name", "nextRunAt", "lastRunAt", "runCount")
        VALUES (
          ${GATE_NAME},
          now() + make_interval(secs => ${seconds}::double precision),
          now(),
          1
        )
        ON CONFLICT ("name") DO UPDATE
          SET "nextRunAt" = now() + make_interval(secs => ${seconds}::double precision),
              "lastRunAt" = now(),
              "runCount" = "CronTick"."runCount" + 1
          WHERE "CronTick"."nextRunAt" <= now()
      `;

      return affected === 1;
    } catch (err) {
      // 게이트가 고장 났다고 사용자 요청까지 죽일 수는 없다. 이번 틱만 거른다.
      this.logger.error(`틱 게이트 실패: ${describe(err)}`);
      return false;
    }
  }

  /** 등록된 잡을 순서대로 전부 돌린다. 하나가 죽어도 나머지는 계속 간다. */
  private async runAll(trigger: TickReport['trigger']): Promise<TickReport> {
    const startedAt = Date.now();
    const results: TickJobResult[] = [];

    for (const job of this.sorted()) {
      const jobStartedAt = Date.now();

      try {
        const result = await job.run();
        results.push({ job: job.name, ok: true, ms: Date.now() - jobStartedAt, result });
      } catch (err) {
        // 전부 at-least-once 전제라 실패한 잡은 다음 틱이 그대로 다시 집는다.
        // 여기서 throw 하면 뒤에 있는 잡들이 통째로 굶는다.
        const error = describe(err);
        this.logger.error(`[${trigger}] ${job.name} 실패: ${error}`);
        results.push({ job: job.name, ok: false, ms: Date.now() - jobStartedAt, error });
      }
    }

    const failed = results.filter((r) => !r.ok).length;
    const report: TickReport = {
      trigger,
      ran: results.length,
      failed,
      ms: Date.now() - startedAt,
      results,
    };

    if (failed > 0) {
      this.logger.warn(`[${trigger}] 잡 ${results.length}개 중 ${failed}개 실패 (${report.ms}ms)`);
    } else {
      this.logger.log(`[${trigger}] 잡 ${results.length}개 완료 (${report.ms}ms)`);
    }

    return report;
  }

  private sorted(): TickJob[] {
    // 같은 order 끼리는 이름순 — 배포마다 실행 순서가 흔들리면 로그 비교가 안 된다.
    return [...this.jobs].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  }

  private intervalSeconds(): number {
    const parsed = Number(process.env.TICK_INTERVAL_SECONDS);
    // 0 이나 음수를 넣으면 요청마다 전 잡이 돈다. 하한을 둔다.
    return Number.isFinite(parsed) && parsed >= 5 ? parsed : DEFAULT_INTERVAL_SECONDS;
  }
}

/** 응답을 붙잡아 두는 시간의 상한. 초과분은 백그라운드로 흘려보낸다. */
export const TICK_AWAIT_BUDGET_MS = AWAIT_BUDGET_MS;

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
