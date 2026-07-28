/**
 * Vercel Blob 직접 업로드 (2단계 핸드셰이크의 클라이언트 쪽).
 *
 * 파일 본문이 우리 API 함수를 통과하지 않는다. Vercel 서버리스 함수의 요청 바디 상한은
 * 4.5MB 이고, 8MB 이미지를 함수로 흘려보내면 상한에 걸리거나 실행 시간을 통째로 잡아먹는다.
 * 그래서 흐름이 셋으로 쪼개져 있다:
 *
 *   1) 서버에서 업로드 티켓 발급 — 경로·타입·용량·만료(60초)가 못 박힌 토큰이 나온다
 *   2) 브라우저 → Blob 스토어로 PUT (이 파일)
 *   3) 서버에 "다 올렸다" 등록 — 서버가 head() 로 실제 크기·타입을 다시 확인한다
 *
 * 3번이 있으므로 2번에서 클라이언트가 보내는 값은 아무것도 신뢰 대상이 아니다.
 *
 * NOTE: `@vercel/blob/client` 의 `upload()` 가 하는 일을 fetch 한 번으로 줄여 놓은 것이다.
 * apps/web 에 의존성을 추가하지 않기로 했기 때문인데, 업로드 API 버전 헤더는 SDK 를
 * 따라가야 하는 값이라 SDK 를 넣게 되면 이 파일은 지우는 게 맞다.
 */

const BLOB_API_ORIGIN = 'https://blob.vercel-storage.com';
/** SDK 가 보내는 값과 같아야 한다. 올라가면 여기도 올린다. */
const BLOB_API_VERSION = '7';

export interface BlobUploadResult {
  url: string;
  pathname: string;
  contentType: string;
}

export interface UploadedImageMeta extends BlobUploadResult {
  width: number;
  height: number;
}

/**
 * 티켓으로 받은 경로에 파일을 올린다.
 *
 * 경로는 **서버가 정한 것 그대로** 써야 한다. 클라이언트가 경로를 고르게 두면
 * 남의 시설 경로에 덮어쓸 수 있고(`addRandomSuffix:false` 라 실제로 성공한다),
 * 토큰도 그 경로에만 유효하므로 바꾸면 어차피 403 이 난다.
 */
export async function uploadToBlob(args: {
  pathname: string;
  clientToken: string;
  file: File;
}): Promise<BlobUploadResult> {
  const { pathname, clientToken, file } = args;

  let response: Response;
  try {
    response = await fetch(`${BLOB_API_ORIGIN}/${encodeURI(pathname)}`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${clientToken}`,
        'x-api-version': BLOB_API_VERSION,
        'x-content-type': file.type,
        'x-add-random-suffix': '0',
      },
      body: file,
    });
  } catch {
    throw new Error('파일을 올리지 못했습니다. 네트워크 상태를 확인하고 다시 시도해 주세요.');
  }

  if (!response.ok) {
    // 티켓은 60초짜리다. 파일을 고르다 시간이 지나는 일이 실제로 흔해서 따로 안내한다.
    if (response.status === 401 || response.status === 403) {
      throw new Error('업로드 시간이 만료되었습니다. 파일을 다시 선택해 주세요.');
    }
    throw new Error('파일을 올리지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }

  const body = (await response.json()) as Partial<BlobUploadResult>;

  if (!body.url) {
    throw new Error('업로드 결과를 확인하지 못했습니다. 다시 시도해 주세요.');
  }

  return {
    url: body.url,
    pathname: body.pathname ?? pathname,
    contentType: body.contentType ?? file.type,
  };
}

/**
 * 이미지 해상도를 브라우저에서 읽는다.
 *
 * 서버가 읽지 않는 이유: 디코딩하려면 sharp 같은 네이티브 의존성이 필요하고 그걸
 * 함수 번들에 넣으면 콜드스타트가 배로 뛴다. 해상도는 레이아웃 힌트일 뿐이라
 * 신뢰가 필요한 값이 아니다(크기·타입은 서버가 blob 메타로 직접 확인한다).
 */
export function readImageSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('이미지를 읽지 못했습니다. 다른 파일로 시도해 주세요.'));
    };

    image.src = url;
  });
}

/** 사람이 읽는 파일 크기. 상한을 넘겼다고 알려줄 때 쓴다. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
