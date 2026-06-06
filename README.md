# 안심상속 Vercel 배포 준비본 v0.8.0

이 프로젝트는 v0.7.4 운영 배포 직전 기준을 Vercel/GitHub 배포용으로 정리한 정적 사이트입니다.

## 포함 범위

- 랜딩페이지
- 무료 진단
- Supabase 리드 저장
- 샘플 리포트 PDF
- 결제 오픈 대기 신청
- 로컬 관리자 화면(`#admin`)
- 사업자 리스크/수익모델 체크 문서

## 아직 포함하지 않는 범위

- 실제 카드결제/PG
- 운영용 인증 관리자 조회
- 전문가 실제 추천/배정
- 법률자문/세무자문/유언장 작성 대행

## 로컬 실행

```powershell
cd C:\Projects\Ansimsangsok-Deploy
npm.cmd run build
$env:PORT=5203
npm.cmd start
```

브라우저:

```text
http://localhost:5203/
```

## Vercel 환경변수

Vercel Project Settings → Environment Variables에 아래 값을 등록합니다.

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_SUPABASE_LEADS_TABLE
VITE_ADMIN_ACCESS_KEY
```

`VITE_SUPABASE_ANON_KEY`에는 Supabase의 publishable key 또는 legacy anon public key를 넣습니다. service_role/secret key는 넣지 않습니다.

## 배포 원칙

공개 사이트는 Supabase에 리드 insert만 수행합니다. 운영용 리드 전체 조회는 공개 프론트엔드에 열지 않고, 추후 인증된 서버 API 또는 Supabase Edge Function으로 분리합니다.


## v0.8.2 검색/광고 전 안전점검 반영

- SEO title/description/canonical/OG/Twitter meta 추가
- robots.txt, sitemap.xml 추가
- OG 공유 이미지 SVG 추가
- 검색/광고 공개 전 체크리스트 문서 추가
- 법률자문·전문가 추천 오인 방지 문구 유지


## v0.8.4

PWA나 앱 설치 기능은 추가하지 않고, 모바일 웹에서 중장년·고령 방문자가 중요한 문구를 더 잘 읽을 수 있도록 글자 크기, 줄간격, 터치 영역, 대비를 보강했습니다. 한글 인코딩은 UTF-8 기준으로 유지합니다.
