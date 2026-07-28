import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

/**
 * 부팅 시점에 환경변수를 검증한다.
 * 서버리스에서는 설정 오류가 런타임 500으로 흩어지기 쉬우므로 여기서 일찍 터뜨린다.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3001),

  // Database
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url().optional(),

  // Auth — 구글 자격증명은 **개발에서는 없어도 부팅된다.**
  //
  // 필수로 두면 화면 하나 보려고 Google Cloud 프로젝트부터 만들어야 한다. 그 대신
  // 비어 있으면 GoogleStrategy 를 아예 등록하지 않고, /auth/google 만 503 으로 닫는다.
  // (운영에서는 아래 superRefine 이 비어 있는 걸 막는다.)
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_CALLBACK_URL: z.string().url(),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default('7d'),

  // URLs
  WEB_APP_URL: z.string().url(),
  CORS_ORIGINS: z.string().optional(),

  // Storage / mail
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('Dibs <no-reply@dibs.example>'),

  // Cron
  CRON_SECRET: z.string().min(16).optional(),

  // 디파짓 홀드 (D-05) — MVP에서는 꺼둔다
  DEPOSIT_HOLD_ENABLED: bool,
  DEPOSIT_HOLD_WINDOW_MINUTES: z.coerce.number().int().positive().default(10),

  SWAGGER_ENABLED: z.string().optional(),
});

/**
 * 개발에서는 느슨하고 운영에서는 엄격한 항목들.
 *
 * "개발 편의"와 "운영 안전"이 충돌하는 값들은 여기서 갈라 준다. 스키마 자체를 느슨하게
 * 두면 운영에 구글 자격증명 없이 배포돼도 조용히 뜨고, 로그인만 안 되는 서비스가 된다.
 */
export const envSchemaWithProdChecks = envSchema.superRefine((env, ctx) => {
  if (env.NODE_ENV !== 'production') return;

  const requiredInProd: Array<[keyof typeof env, string]> = [
    ['GOOGLE_CLIENT_ID', '구글 로그인이 유일한 인증 수단이다'],
    ['GOOGLE_CLIENT_SECRET', '구글 로그인이 유일한 인증 수단이다'],
    ['CRON_SECRET', '비어 있으면 CronGuard 가 모든 크론을 거절해 만료·정산이 멈춘다'],
  ];

  for (const [key, why] of requiredInProd) {
    if (!env[key]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `운영 환경에서는 필수입니다 — ${why}.`,
      });
    }
  }
});

export type Env = z.infer<typeof envSchema>;

/** 구글 로그인을 실제로 쓸 수 있는 상태인가. */
export function isGoogleAuthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}
