-- Category.venueCount / Region.venueCount 제거.
--
-- 비정규화 캐시로 만들어졌지만 **갱신하는 코드가 한 곳도 없었다.** 시드가 넣은 값이
-- 그대로 굳어, 시설을 전부 지운 뒤에도 업종 관리 화면이 "시설 1곳"이라고 표시했다.
-- 운영자가 그 숫자를 눌러도 목록은 비어 있었다.
--
-- 읽는 쪽도 없었다. 파트너 화면의 "시설 N곳"은 Business._count.venues(실측)이고,
-- 탐색 화면은 주석으로 "Category.venueCount 로 고르면 빈 섹션이 생긴다"며 일부러 피했다.
-- 운영자 화면은 이제 AdminCategoriesService.countVenuesByCategory 로 실측한다 —
-- 목록 필터와 같은 WHERE 를 쓰므로 숫자와 목록이 어긋날 수 없다.
--
-- 나중에 규모 때문에 캐시가 정말 필요해지면, 그때는 갱신 경로와 대사 크론을
-- 함께 넣어야 한다. 갱신되지 않는 캐시는 없는 것보다 나쁘다.
ALTER TABLE "Category" DROP COLUMN IF EXISTS "venueCount";
ALTER TABLE "Region" DROP COLUMN IF EXISTS "venueCount";
