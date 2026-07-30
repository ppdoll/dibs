import { ImageResponse } from 'next/og';

import { BRAND_COLOR, BRAND_COPY, BRAND_INK, BRAND_MUTED, markDataUri } from '@/lib/brand';
import { loadBrandFonts } from '@/lib/og-font';

export const alt = `${BRAND_COPY.wordmark} — ${BRAND_COPY.headline}`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** 라틴 폰트만 잡혔을 때 쓸 문구. 한글 자리에 두부를 그리느니 영어로 바꾼다. */
const LATIN_FALLBACK = {
  headline: 'Call it first.',
  sub: 'The moment it opens, the spot is yours.',
};

export default async function OpengraphImage() {
  const { fonts, korean, family } = await loadBrandFonts(
    // 여기 빠진 글자는 렌더링에서 두부가 된다. 실제로 그리는 문자열을 그대로 넘긴다.
    BRAND_COPY.wordmark + BRAND_COPY.headline + BRAND_COPY.sub,
  );

  const headline = korean ? BRAND_COPY.headline : LATIN_FALLBACK.headline;
  const sub = korean ? BRAND_COPY.sub : LATIN_FALLBACK.sub;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          backgroundColor: '#ffffff',
          padding: '76px 84px 96px',
          fontFamily: family,
          position: 'relative',
        }}
      >
        {/*
          브랜드 컬러 번짐. radial-gradient 대신 반투명 원을 쓴다 —
          Satori 의 그라디언트 지원은 버전을 타는데, 이건 어디서든 같게 나온다.
        */}
        <div
          style={{
            position: 'absolute',
            top: -260,
            right: -200,
            width: 720,
            height: 720,
            borderRadius: 9999,
            backgroundColor: BRAND_COLOR,
            opacity: 0.09,
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={markDataUri({ size: 92 })} alt="" width={92} height={92} />
          <span
            style={{
              marginLeft: 26,
              fontSize: 54,
              fontWeight: 700,
              color: BRAND_INK,
              letterSpacing: -1.5,
            }}
          >
            {BRAND_COPY.wordmark}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              fontSize: 96,
              fontWeight: 700,
              color: BRAND_INK,
              letterSpacing: -3.5,
              lineHeight: 1.12,
            }}
          >
            {headline}
          </div>
          <div
            style={{
              marginTop: 30,
              fontSize: 38,
              fontWeight: 400,
              color: BRAND_MUTED,
              lineHeight: 1.4,
            }}
          >
            {sub}
          </div>
        </div>

        {/* 하단 브랜드 바. 썸네일로 줄어들어도 "이 서비스" 라는 신호가 남는다. */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 16,
            backgroundColor: BRAND_COLOR,
          }}
        />
      </div>
    ),
    { ...size, fonts },
  );
}
