# 식단 기록

끼니별(아침·점심·간식·저녁) 식단을 기록하고 영양성분을 자동으로 찾아 주는 PWA 앱.

- **외식**: "상호 메뉴명" 한 칸 입력 → 식약처 DB(프랜차이즈 메뉴 포함)에서 찾고, 없으면 Gemini가 추정
- **조리**: 넣은 식재료를 한 줄씩 입력 → 식약처 DB에서 찾아 합산, 양("2개", "1큰술")은 그램으로 환산
- **식품**: 바로 먹는 제품·과일 → 식약처 가공식품 제품 DB(`public/products.json`)에서 찾고, 없으면 Gemini
- **즐겨찾기**: ⭐ 표시한 메뉴와 최근 먹은 것을 한 번에 다시 기록
- **끼니 평가**: 목표의 끼니 몫과 비교해 😡 / 😀 / ☺️
- **목표 영양성분**: 체중/인바디 사진, 운동량, 목표(감량·유지·벌크업)로 하루 칼로리와 탄단지 추천
- 데이터는 각 휴대폰(IndexedDB)에만 저장. 서버 없음. 설정에서 백업 파일 저장/불러오기

## 개발

```bash
npm install
npm run dev
```

## 식약처 DB 갱신

공공데이터포털의 전국통합식품영양성분정보 표준데이터(원재료성식품·음식·가공식품)를 받아
`public/food-db.json`을 다시 만듭니다.

```bash
npm run build:food-db
```

## 안드로이드·아이폰 앱 (건강 데이터)

웹 코드를 Capacitor로 감싼 앱. 활동 화면에서 Health Connect(삼성헬스) / HealthKit의
걸음 수·활동 칼로리·운동 기록·체중·체지방을 읽어 옴.

- 안드로이드: `main`에 push하면 `.github/workflows/android.yml`이 서명된 APK를 만들어
  [releases/android](https://github.com/kangsogo7/meal-log/releases/tag/android)에 올림.
  서명 키는 저장소 Secrets(`ANDROID_KEYSTORE_*`)에 있고 원본은 개발 PC 홈 폴더에 보관.
- 아이폰: `.github/workflows/ios.yml`이 macOS에서 서명 없이 빌드만 확인.
  Apple 개발자 계정이 생기면 서명·TestFlight 단계 추가 (파일 안 주석 참고).
- 아이폰 웹앱에서는 단축어로 건강 데이터를 복사해 붙여넣기.

```bash
npm run cap:sync   # 웹 빌드(native 모드) + 안드로이드/iOS 프로젝트에 복사
```

## 배포

`main` 브랜치에 push하면 GitHub Actions가 빌드해서 GitHub Pages에 올립니다.
저장소 이름을 바꾸면 `vite.config.ts`의 `BASE`도 같이 바꿔야 합니다.
