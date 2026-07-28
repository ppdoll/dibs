-- 컨테이너를 처음 만들 때 한 번만 실행된다 (볼륨이 비어 있을 때).
--
-- pg_trgm: 한글 부분일치 검색이 이걸 쓴다. 검색 모듈의 인덱스가 전제로 깔고 있어서,
--          없으면 001_constraints.sql 이나 검색 쿼리가 실패한다.
-- pgcrypto: 감사 로그 해시 체인이 digest() 를 쓴다.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
