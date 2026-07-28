import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'dibs:isPublic';

/**
 * 인증 없이 열어둘 엔드포인트에 붙인다.
 *
 * 기본값이 "인증 필요"이고 여기에 명시한 것만 열린다. 반대로 했다가는
 * 새 컨트롤러를 만들 때마다 가드를 붙이는 걸 잊어 조용히 열려버린다.
 * 탐색·검색처럼 로그인 없이 둘러보는 화면이 이걸 쓴다.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
