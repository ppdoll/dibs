import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { del, head, list } from '@vercel/blob';
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';

/** 시설 이미지 허용 타입. 브라우저가 그대로 그릴 수 있는 것만 받는다. */
export const VENUE_IMAGE_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
] as const;

/** 사업자등록증 사본. 스캔본이 대부분이라 PDF 를 함께 받는다. */
export const BUSINESS_DOC_CONTENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;

export const VENUE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const BUSINESS_DOC_MAX_BYTES = 10 * 1024 * 1024;

/** 업로드 토큰 유효시간. 짧게 준다 — 토큰이 새면 그 경로에 아무거나 올릴 수 있다. */
const UPLOAD_TOKEN_TTL_MS = 60_000;
/** 사업자등록증 열람 URL 을 응답에 담아두는 시간. 로그·히스토리에 남는 걸 전제로 짧게 잡는다. */
export const DOC_URL_TTL_MS = 60_000;

export interface UploadTicket {
  /** 클라이언트가 `upload(pathname, file, { access:'public', token })` 에 그대로 넣는다. */
  clientToken: string;
  pathname: string;
  expiresAt: Date;
  maxBytes: number;
  allowedContentTypes: readonly string[];
}

/**
 * Vercel Blob 2단계 업로드 핸드셰이크의 서버 쪽.
 *
 * 파일 본문이 서버 함수를 통과하지 않는다 — Vercel 함수의 요청 바디 상한(4.5MB)과
 * 실행 시간을 이미지가 잡아먹으면 안 되기 때문이다. 대신 서버는
 * **경로를 못 박은 짧은 토큰**만 발급하고, 업로드가 끝나면 클라이언트가 등록을 요청한다.
 *
 * 경로를 서버가 정하는 게 핵심이다. 클라이언트가 pathname 을 정하게 두면
 * 남의 시설 경로에 덮어쓸 수 있고, `addRandomSuffix:false` 라 그 덮어쓰기가 실제로 성공한다.
 */
@Injectable()
export class PartnerBlobService {
  private readonly logger = new Logger(PartnerBlobService.name);

  constructor(private readonly config: ConfigService) {}

  /** 시설 이미지 경로. imageId 를 쓰므로 DB 행 1개와 blob 1개가 1:1 로 묶인다. */
  venueImagePathname(venueId: string, imageId: string, contentType: string): string {
    return `venues/${venueId}/${imageId}.${extensionFor(contentType)}`;
  }

  /**
   * 사업자등록증 경로.
   *
   * 이 스토어는 public access 만 지원하므로 URL 자체가 사실상 유일한 자격증명이다.
   * 그래서 추측 불가능한 난수 조각을 경로에 넣고, URL 은 어떤 목록 응답에도 싣지 않는다
   * (스키마 주석의 "원본 URL 은 어떤 응답에도 넣지 않는다"가 이 뜻이다).
   */
  businessDocPathname(businessId: string, nonce: string, contentType: string): string {
    return `business-docs/${businessId}/${nonce}.${extensionFor(contentType)}`;
  }

  async createUploadTicket(input: {
    pathname: string;
    allowedContentTypes: readonly string[];
    maxBytes: number;
  }): Promise<UploadTicket> {
    const expiresAt = new Date(Date.now() + UPLOAD_TOKEN_TTL_MS);

    const clientToken = await generateClientTokenFromReadWriteToken({
      token: this.readWriteToken(),
      pathname: input.pathname,
      // 서버가 정한 경로 그대로 올라와야 DB 행과 blob 이 어긋나지 않는다.
      addRandomSuffix: false,
      allowedContentTypes: [...input.allowedContentTypes],
      maximumSizeInBytes: input.maxBytes,
      validUntil: expiresAt.getTime(),
    });

    return {
      clientToken,
      pathname: input.pathname,
      expiresAt,
      maxBytes: input.maxBytes,
      allowedContentTypes: input.allowedContentTypes,
    };
  }

  /**
   * 등록 단계에서 실제 blob 을 확인한다.
   *
   * 크기·타입을 클라이언트가 보낸 값으로 믿으면 상한 검사가 장식이 된다.
   * 경로까지 대조하는 이유: 토큰은 경로를 못 박지만, 등록 요청은 아무 URL 이나 보낼 수 있다.
   */
  async verifyUploaded(blobUrl: string, expectedPathname: string) {
    const meta = await head(blobUrl, { token: this.readWriteToken() }).catch(() => null);

    if (!meta) {
      throw new BadRequestException('업로드된 파일을 찾을 수 없습니다. 업로드를 다시 시도해 주세요.');
    }
    if (meta.pathname !== expectedPathname) {
      throw new BadRequestException('업로드 경로가 발급받은 경로와 다릅니다.');
    }

    return meta;
  }

  /**
   * 열람용 URL. 만료가 붙은 값이라는 걸 호출부가 응답에 함께 담는다.
   *
   * pathname 으로 찾는다. `head()` 는 URL 만 받는데 Business 에는 pathname 컬럼밖에 없다 —
   * 원본 URL 을 컬럼으로 두면 `select` 하나가 그걸 목록 응답에 실어 나르는 순간
   * 사실상 영구 공개 링크가 된다(이 스토어는 public access 만 지원한다).
   * 그래서 열람할 때마다 prefix 로 다시 찾는다. 열람은 드문 경로라 비용을 감수한다.
   */
  async resolveDownloadUrl(blobPathname: string) {
    const found = await this.findByPathname(blobPathname);

    if (!found) {
      throw new BadRequestException('첨부 파일을 찾을 수 없습니다.');
    }

    // NOTE(seam): 실제 서명 URL 은 스토어가 private 를 지원할 때 여기서 만든다.
    // 지금은 downloadUrl 을 짧은 만료와 함께 넘기고, 열람 사실을 감사 로그로 남긴다.
    return { url: found.downloadUrl, expiresAt: new Date(Date.now() + DOC_URL_TTL_MS) };
  }

  /** pathname 만 아는 blob 을 지운다(사업자등록증 교체). 삭제와 같은 이유로 커밋 이후에 부른다. */
  async deleteByPathnameQuietly(blobPathname: string): Promise<void> {
    try {
      const found = await this.findByPathname(blobPathname);
      if (found) await del(found.url, { token: this.readWriteToken() });
    } catch (error) {
      this.logger.warn(`blob 삭제 실패(스위퍼가 재시도한다): ${blobPathname} — ${String(error)}`);
    }
  }

  /**
   * prefix 조회는 "앞부분이 같은" 것까지 물어오므로 pathname 완전일치로 한 번 더 거른다.
   * `business-docs/{id}/ab` 가 `business-docs/{id}/abcd` 를 잡아오면 남의 첨부를 열게 된다.
   */
  private async findByPathname(blobPathname: string) {
    const { blobs } = await list({
      token: this.readWriteToken(),
      prefix: blobPathname,
      limit: 10,
    });

    return blobs.find((blob) => blob.pathname === blobPathname) ?? null;
  }

  /**
   * blob 삭제는 **커밋 이후에** 부른다. (IC-42 와 같은 이유)
   * 트랜잭션 안에서 외부 API 를 부르면 롤백돼도 파일은 이미 사라진다.
   * 실패해도 DB 는 이미 소프트 삭제 상태이므로 스위퍼가 다시 집어간다 — 여기서 던지지 않는다.
   */
  async deleteQuietly(blobUrl: string): Promise<void> {
    try {
      await del(blobUrl, { token: this.readWriteToken() });
    } catch (error) {
      this.logger.warn(`blob 삭제 실패(스위퍼가 재시도한다): ${blobUrl} — ${String(error)}`);
    }
  }

  private readWriteToken(): string {
    const token = this.config.get<string>('BLOB_READ_WRITE_TOKEN');

    if (!token) {
      // 토큰 없이 업로드 경로를 열어두면 클라이언트가 원인을 알 수 없는 실패를 받는다.
      throw new ServiceUnavailableException('이미지 저장소가 설정되지 않았습니다.');
    }

    return token;
  }
}

function extensionFor(contentType: string): string {
  switch (contentType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/avif':
      return 'avif';
    case 'application/pdf':
      return 'pdf';
    default:
      throw new BadRequestException('지원하지 않는 파일 형식입니다.');
  }
}
