/**
 * 클라이언트에 노출되는 환경값.
 *
 * api-client 와 auth 가 서로를 import 하면 순환이 생긴다. 두 모듈이 함께 쓰는
 * 값(API 주소)만 여기로 빼서 의존 방향을 한 줄로 만든다.
 *
 * NEXT_PUBLIC_ 접두사는 빌드 시점에 문자열로 치환된다. 그래서
 * `process.env[key]` 같은 동적 접근을 쓰면 안 되고 반드시 리터럴로 적어야 한다.
 */

/** 백엔드 주소. 끝의 슬래시는 떼어 둔다 — 경로를 붙일 때 `//` 가 생기면 라우팅이 어긋난다. */
export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/+$/, '');

/** 브라우저에서 실행 중인지. 서버 컴포넌트에는 localStorage 도 window 도 없다. */
export const isBrowser = typeof window !== 'undefined';
