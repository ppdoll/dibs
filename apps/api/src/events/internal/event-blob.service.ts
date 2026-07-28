import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { del, head } from '@vercel/blob';
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';

/** 이벤트 이미지 허용 타입. 브라우저가 그대로 그릴 수 있는 것만 받는다. */
export const EVENT_IMAGE_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
] as const;

export type EventImageContentType = (typeof EVENT_IMAGE_CONTENT_TYPES)[number];

export const EVENT_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

/** 업로드 토큰 유효시간. 짧게 준다 — 토큰이 새면 그 경로에 아무거나 올릴 수 있다. */
const UPLOAD_TOKEN_TTL_MS = 60_000;

export interface EventUploadTicket {
  /** 이 티켓으로 올린 파일이 등록될 EventImage.id. 서버가 미리 못 박는다. */
  imageId: string;
  /** 클라이언트가 `upload(pathname, file, { access:'public', token })` 에 그대로 넣는다. */
  clientToken: string;
  pathname: string;
  expiresAt: Date;
  maxBytes: number;
  allowedContentTypes: readonly string[];
}

/**
 * 이벤트 이미지의 Vercel Blob 2단계 업로드 핸드셰이크. 시설 이미지와 같은 형태다.
 *
 * 파일 본문이 서버 함수를 통과하지 않는다 — Vercel 함수의 요청 바디 상한(4.5MB)과
 * 실행 시간을 이미지가 잡아먹으면 안 되기 때문이다. 서버는 **경로를 못 박은 짧은 토큰**만
 * 발급하고, 업로드가 끝나면 클라이언트가 등록(register)을 요청한다.
 *
 * 경로를 서버가 정하는 게 핵심이다. 클라이언트가 pathname 을 정하게 두면 남의 이벤트 경로에
 * 덮어쓸 수 있고, `addRandomSuffix:false` 라 그 덮어쓰기가 실제로 성공한다.
 *
 * 파트너 모듈에 거의 같은 서비스가 있지만 import 하지 않는다 — 모듈 간 서비스 의존을 만들면
 * 시설 이미지 정책(허용 타입·상한)을 바꿀 때 이벤트 쪽이 조용히 따라 바뀐다.
 */
@Injectable()
export class EventBlobService {
  private readonly logger = new Logger(EventBlobService.name);

  constructor(private readonly config: ConfigService) {}

  /** imageId 를 경로에 넣어 DB 행 1개와 blob 1개를 1:1 로 묶는다. 고아 blob 대사(對査)의 기준이다. */
  imagePathname(eventId: string, imageId: string, contentType: string): string {
    return `events/${eventId}/${imageId}.${extensionFor(contentType)}`;
  }

  async createUploadTicket(input: {
    imageId: string;
    pathname: string;
  }): Promise<EventUploadTicket> {
    const expiresAt = new Date(Date.now() + UPLOAD_TOKEN_TTL_MS);

    const clientToken = await generateClientTokenFromReadWriteToken({
      token: this.readWriteToken(),
      pathname: input.pathname,
      // 서버가 정한 경로 그대로 올라와야 DB 행과 blob 이 어긋나지 않는다.
      addRandomSuffix: false,
      allowedContentTypes: [...EVENT_IMAGE_CONTENT_TYPES],
      maximumSizeInBytes: EVENT_IMAGE_MAX_BYTES,
      validUntil: expiresAt.getTime(),
    });

    return {
      imageId: input.imageId,
      clientToken,
      pathname: input.pathname,
      expiresAt,
      maxBytes: EVENT_IMAGE_MAX_BYTES,
      allowedContentTypes: EVENT_IMAGE_CONTENT_TYPES,
    };
  }

  /**
   * 등록 단계에서 실제 blob 을 확인한다.
   *
   * 크기·타입을 클라이언트가 보낸 값으로 믿으면 상한 검사가 장식이 된다 — 그래서 head() 로 직접 읽는다.
   * 경로를 (eventId, imageId) 로 **다시 계산해서** 대조하는 것이 핵심이다:
   * 업로드 토큰은 경로를 못 박지만 등록 요청은 아무 URL 이나 보낼 수 있으므로,
   * 이 검사가 없으면 남의 이벤트에 올라간 blob 을 내 이벤트 이미지로 등록할 수 있다.
   */
  async verifyUploaded(blobUrl: string, eventId: string, imageId: string) {
    const meta = await head(blobUrl, { token: this.readWriteToken() }).catch(() => null);

    if (!meta) {
      throw new BadRequestException('업로드된 파일을 찾을 수 없습니다. 업로드를 다시 시도해 주세요.');
    }
    if (!(EVENT_IMAGE_CONTENT_TYPES as readonly string[]).includes(meta.contentType)) {
      throw new BadRequestException('지원하지 않는 이미지 형식입니다.');
    }
    if (meta.size > EVENT_IMAGE_MAX_BYTES) {
      throw new BadRequestException('이미지 용량이 허용 범위를 넘었습니다.');
    }
    if (meta.pathname !== this.imagePathname(eventId, imageId, meta.contentType)) {
      throw new BadRequestException('업로드 경로가 발급받은 경로와 다릅니다.');
    }

    return meta;
  }

  /**
   * blob 삭제는 **커밋 이후에** 부른다.
   * 트랜잭션 안에서 외부 API 를 부르면 롤백돼도 파일은 이미 사라진다.
   * 실패해도 DB 는 이미 소프트 삭제 상태라 고아 스위퍼가 다시 집어간다 — 여기서 던지지 않는다.
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
    default:
      throw new BadRequestException('지원하지 않는 이미지 형식입니다.');
  }
}
