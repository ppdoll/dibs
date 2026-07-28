/**
 * 백엔드로 나가는 유일한 통로.
 *
 * 화면 코드가 fetch 를 직접 부르지 않게 하려고 만든다. 토큰 부착, 401 처리,
 * 에러 봉투 해석, 멱등키 — 이 네 가지를 한 곳에서만 다루기 위해서다.
 * 한 군데라도 새로 fetch 를 쓰기 시작하면 그 규칙들이 갈라진다.
 *
 * 경로는 `docs/API-ROUTES.md` 에 적힌 그대로 넘긴다. 즉 **`/api` 를 포함한다.**
 *   apiGet<Me>('/api/auth/me')
 * 문서와 코드가 글자 단위로 같아야 "이 경로 있나?" 를 검색 한 번으로 끝낼 수 있다.
 */

import { API_BASE_URL, isBrowser } from './env';
import { clearToken, getToken } from './token';
import type { ApiErrorBody, ApiValidationIssue } from '@/types/api';

// ─── 에러 ─────────────────────────────────────────────────────────────

/**
 * 백엔드가 돌려준 실패.
 *
 * `issues` 는 DomainExceptionFilter 가 실어 보낸 필드별 한국어 문구다.
 * 폼은 이걸 그대로 필드 밑에 붙이면 된다 — 프론트에서 문구를 다시 만들면
 * 서버 규칙이 바뀔 때 조용히 어긋난다.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly issues: ApiValidationIssue[];
  readonly body: ApiErrorBody | null;
  /** 네트워크가 끊겼거나 서버에 닿지 못한 경우. 재시도할 가치가 있는 유일한 실패다. */
  readonly isNetwork: boolean;

  constructor(args: {
    status: number;
    message: string;
    issues?: ApiValidationIssue[];
    body?: ApiErrorBody | null;
    isNetwork?: boolean;
  }) {
    super(args.message);
    this.name = 'ApiError';
    this.status = args.status;
    this.issues = args.issues ?? [];
    this.body = args.body ?? null;
    this.isNetwork = args.isNetwork ?? false;
  }

  /** 특정 필드에 붙일 문구. 없으면 undefined. */
  fieldMessage(field: string): string | undefined {
    return this.issues.find((issue) => issue.field === field)?.message;
  }

  /** 필드 → 문구 맵. react-hook-form 없이 useState 로 폼을 굴릴 때 편하다. */
  fieldErrors(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const issue of this.issues) {
      if (issue.field && !(issue.field in map)) map[issue.field] = issue.message;
    }
    return map;
  }

  /** 코드로 분기할 때. 문구는 바뀌어도 코드는 유지된다. */
  hasCode(code: string): boolean {
    return this.issues.some((issue) => issue.code === code);
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isConflict(): boolean {
    return this.status === 409;
  }
}

// ─── 요청 옵션 ────────────────────────────────────────────────────────

export type QueryValue = string | number | boolean | null | undefined | Array<string | number>;
export type QueryParams = Record<string, QueryValue>;

export interface RequestOptions {
  /** 쿼리스트링. undefined/null 인 값은 아예 빠진다. */
  query?: QueryParams;
  signal?: AbortSignal;
  /** 추가 헤더. Authorization 은 여기 넣지 말고 token 을 쓴다. */
  headers?: Record<string, string>;
  /**
   * 서버 컴포넌트에서 쓸 토큰. 브라우저에는 localStorage 가 있지만
   * 서버에는 없다. 필요하면 명시로 넘긴다.
   */
  token?: string | null;
  /** 로그인 없이도 되는 공개 요청이면 false. 토큰이 있어도 안 붙인다. */
  withAuth?: boolean;
  /** 상태를 바꾸는 요청에 붙는 멱등키. mutate 계열이 없으면 자동 생성한다. */
  idempotencyKey?: string;
  /** 401 을 만나도 로그인 화면으로 보내지 않는다 (예: /auth/me 최초 확인). */
  skipAuthRedirect?: boolean;
  cache?: RequestCache;
  /** Next.js 서버 fetch 캐시 옵션 */
  next?: { revalidate?: number | false; tags?: string[] };
}

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

// ─── URL 조립 ─────────────────────────────────────────────────────────

function buildUrl(path: string, query?: QueryParams): string {
  const base = API_BASE_URL;
  let normalizedPath = path.startsWith('/') ? path : `/${path}`;

  // NEXT_PUBLIC_API_URL 을 ".../api" 로 넣어둔 환경도 있다. 문서대로 '/api/...' 를
  // 넘긴 호출부가 그 때문에 깨지지 않도록 겹치는 접두사를 한 번 걷어낸다.
  if (base.endsWith('/api') && normalizedPath.startsWith('/api/')) {
    normalizedPath = normalizedPath.slice(4);
  }

  const search = buildSearch(query);
  return `${base}${normalizedPath}${search}`;
}

function buildSearch(query?: QueryParams): string {
  if (!query) return '';

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item));
    } else {
      params.append(key, String(value));
    }
  }

  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : '';
}

// ─── 멱등키 ───────────────────────────────────────────────────────────

/**
 * 요청 하나를 가리키는 고유값. 신청 계열 엔드포인트가 **필수로** 요구한다.
 *
 * 같은 키로 다시 보내면 서버가 처음 응답을 그대로 재생한다. 그래서 재시도는
 * 반드시 **같은 키**로 해야 한다 — 매번 새로 만들면 중복 신청이 된다.
 * 사용자의 "신청" 클릭 한 번당 하나를 만들어 붙잡고 있어야 한다는 뜻이다.
 */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // randomUUID 가 없는 오래된 환경(비 HTTPS 등)용 대체.
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

// ─── 401 처리 ─────────────────────────────────────────────────────────

/** 로그인 화면으로 보낼 때 원래 있던 곳을 기억해 둔다. */
function redirectToLogin(): void {
  if (!isBrowser) return;

  const here = `${window.location.pathname}${window.location.search}`;
  // 이미 인증 화면이면 그대로 둔다. 안 그러면 무한 리다이렉트가 된다.
  if (here.startsWith('/auth/')) return;

  window.location.replace(`/auth/login?redirect=${encodeURIComponent(here)}`);
}

// ─── 본체 ─────────────────────────────────────────────────────────────

async function request<T>(
  method: HttpMethod,
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<T> {
  if (API_BASE_URL === '') {
    throw new ApiError({
      status: 0,
      message: 'API 주소가 설정되지 않았습니다. NEXT_PUBLIC_API_URL 을 확인해 주세요.',
    });
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...options.headers,
  };

  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const useAuth = options.withAuth ?? true;
  const token = options.token ?? (useAuth ? getToken() : null);
  if (useAuth && token) headers.Authorization = `Bearer ${token}`;

  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.cache ? { cache: options.cache } : {}),
      ...(options.next ? { next: options.next } : {}),
    });
  } catch (cause) {
    // AbortError 는 사용자가 화면을 떠난 것이므로 그대로 던진다.
    // React Query 가 취소로 인식해야 하고, 실패로 세면 안 된다.
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;

    throw new ApiError({
      status: 0,
      message: '네트워크에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      isNetwork: true,
    });
  }

  if (response.status === 401) {
    // 토큰이 죽었다. 남겨두면 이후 모든 요청이 같은 방식으로 실패한다.
    clearToken();
    if (!options.skipAuthRedirect) redirectToLogin();
  }

  if (response.status === 204 || response.status === 205) {
    return undefined as T;
  }

  const payload = await readBody(response);

  if (!response.ok) {
    throw toApiError(response.status, payload);
  }

  return payload as T;
}

async function readBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  const text = await response.text();
  return text.length > 0 ? text : null;
}

function toApiError(status: number, payload: unknown): ApiError {
  const body = isErrorBody(payload) ? payload : null;

  return new ApiError({
    status,
    message: extractMessage(status, body, payload),
    issues: body?.issues ?? [],
    body,
  });
}

function isErrorBody(payload: unknown): payload is ApiErrorBody {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload);
}

/** 화면 위쪽 배너에 띄울 한 줄. 필드별 문구는 issues 가 따로 들고 있다. */
function extractMessage(status: number, body: ApiErrorBody | null, raw: unknown): string {
  if (body) {
    if (Array.isArray(body.message) && body.message.length > 0) {
      return body.message.filter((m) => typeof m === 'string').join('\n');
    }
    if (typeof body.message === 'string' && body.message.length > 0) return body.message;
    if (body.issues && body.issues.length > 0) {
      return body.issues.map((issue) => issue.message).join('\n');
    }
  }

  if (typeof raw === 'string' && raw.length > 0 && raw.length < 300) return raw;

  return DEFAULT_MESSAGE[status] ?? '요청을 처리하지 못했습니다.';
}

const DEFAULT_MESSAGE: Record<number, string> = {
  400: '입력한 내용을 다시 확인해 주세요.',
  401: '로그인이 필요합니다.',
  403: '권한이 없습니다.',
  404: '대상을 찾을 수 없습니다.',
  409: '지금은 처리할 수 없는 상태입니다.',
  422: '요청 내용이 이전과 달라 처리할 수 없습니다.',
  429: '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.',
  500: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  503: '서비스 점검 중입니다. 잠시 후 다시 시도해 주세요.',
};

// ─── 공개 헬퍼 ────────────────────────────────────────────────────────

export function apiGet<T>(path: string, options?: RequestOptions): Promise<T> {
  return request<T>('GET', path, undefined, options);
}

export function apiPost<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
  return request<T>('POST', path, body, options);
}

export function apiPatch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
  return request<T>('PATCH', path, body, options);
}

export function apiPut<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
  return request<T>('PUT', path, body, options);
}

export function apiDelete<T>(path: string, options?: RequestOptions): Promise<T> {
  return request<T>('DELETE', path, undefined, options);
}

/**
 * 멱등키를 붙여 보내는 변형. `/api/applications` 계열은 이 함수로만 부른다.
 *
 * 키를 넘기지 않으면 만들어 붙이지만, **재시도를 생각하면 호출부가 붙잡고
 * 있는 편이 안전하다.** 예: 신청 버튼을 누를 때 키를 하나 만들어 두고,
 * 실패해서 다시 누를 때까지 같은 키를 쓴다.
 */
export function apiMutate<T>(
  method: Exclude<HttpMethod, 'GET'>,
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<T> {
  return request<T>(method, path, body, {
    ...options,
    idempotencyKey: options.idempotencyKey ?? newIdempotencyKey(),
  });
}

/** 가장 흔한 형태 — POST + 멱등키. */
export function apiPostMutate<T>(
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> {
  return apiMutate<T>('POST', path, body, options);
}

/** 던져진 값이 우리 에러인지. catch 블록에서 쓴다. */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** 무엇이 던져졌든 사용자에게 보여줄 한 줄로 만든다. */
export function toUserMessage(error: unknown): string {
  if (isApiError(error)) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return '요청을 처리하지 못했습니다.';
}
