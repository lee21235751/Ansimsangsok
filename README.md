# 안심상속

정적 HTML 페이지와 Vercel API 함수로 구성된 안심상속 사이트입니다.

## 구조

- `public/`: 정적 페이지와 사이트맵 등 공개 파일
- `api/`: Vercel 서버리스 API 함수
- `scripts/build.mjs`: `public/`을 `dist/`로 복사하는 빌드 스크립트
- `vercel.json`: Vercel 빌드 및 함수 설정

## 실행

```bash
npm run build
```


