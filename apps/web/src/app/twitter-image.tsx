/**
 * 트위터/X 카드 이미지.
 *
 * OG 와 같은 그림을 쓴다. 파일을 따로 두는 이유는 Next 가 `twitter-image` 규약이 없으면
 * `twitter:image` 태그를 아예 안 넣기 때문이다 — X 가 `og:image` 로 폴백해 주긴 하지만,
 * 폴백에 기대면 카드 종류(`summary_large_image`)와 이미지가 어긋나는 경우가 생긴다.
 */
export { default, alt, size, contentType } from './opengraph-image';
