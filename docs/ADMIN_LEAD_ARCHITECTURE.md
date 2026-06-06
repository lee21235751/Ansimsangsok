# 안심상속 운영 관리자·리드 구조 설계 v0.7.4

## 목적
운영 배포 전, 공개 랜딩페이지와 관리자 화면을 분리해 개인정보·변호사법·광고 수익모델 리스크를 줄인다.

## 핵심 원칙

1. 공개 사이트는 리드 저장(insert)만 한다.
2. 공개 브라우저 코드에서 leads 전체 조회(select)를 열지 않는다.
3. 운영 관리자 화면은 인증된 서버 API, Supabase Edge Function, 또는 별도 관리자 백엔드에서만 조회한다.
4. 전문가 디렉토리 광고/제휴 데이터는 고객 리드 개인정보와 분리해 관리한다.
5. 상품별 관심도 통계는 개인정보 없이 집계 가능한 구조로 별도 저장하는 것이 좋다.

## 권장 데이터 구조

### leads
무료 진단·구매 의사 리드 저장용. 개인정보가 포함된다.

- id
- created_at
- name
- phone
- email
- memo
- score
- answers(jsonb)
- page_url
- app_version

### lead_events
행동 이벤트 저장용. 가능하면 개인정보 없이 세션/리드 id 기준으로 저장한다.

- id
- created_at
- lead_id nullable
- event_type
- product_key
- metadata(jsonb)

예: sample_pdf_click, offer_card_click, waitlist_click, lead_submit_success.

### expert_profiles
전문가 광고/제휴 프로필. 사건 소개 수수료 구조가 아니라 월정액 광고/프로필 노출 구조로 운영한다.

- id
- display_name
- firm_name
- category
- region
- languages
- is_sponsored
- sponsorship_tier
- profile_status

## 운영 관리자 권한

- 최소 2단계로 분리한다.
  - 리드 조회 관리자
  - 전문가 광고/프로필 관리자
- 리드 다운로드는 관리자 로그를 남긴다.
- CSV 다운로드에는 필요 최소 항목만 포함한다.

## 사업자 리스크 체크

- 리드 조회 API는 공개 anon key로 열지 않는다.
- service role key는 절대 브라우저에 넣지 않는다.
- 전문가 목록은 추천/배정이 아니라 광고 또는 제휴 프로필 목록으로 표시한다.
- 상담 및 선임 여부는 고객이 직접 결정한다고 명시한다.
- 사건별 수임료 배분, 상담 연결 건당 수수료 구조는 쓰지 않는다.

## 다음 개발 단계

1. Supabase Edge Function 또는 Vercel Serverless Function으로 관리자 조회 API 작성.
2. 관리자 로그인 방식 결정.
3. 리드 조회/CSV 다운로드 관리자 로그 저장.
4. lead_events 테이블 추가.
5. 전문가 프로필 테이블 초안 작성.
