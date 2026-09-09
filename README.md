# 질문 생성 레시피 코치 🍳

AI 기반 질문 평가 & 생성 웹앱 (중학생 대상)

## 폴더 구조

```
question-coach/
├── backend/          ← Render에 배포
│   ├── server.js
│   ├── package.json
│   ├── .env.example
│   └── .gitignore
└── frontend/         ← GitHub Pages에 배포
    └── index.html
```

---

## 1단계 — GitHub 저장소 만들기

1. GitHub에서 **New repository** 클릭
2. 이름: `question-coach` (또는 원하는 이름)
3. Public으로 설정
4. 파일 업로드:
   - `backend/` 폴더 전체
   - `frontend/index.html`

---

## 2단계 — Render 백엔드 배포

1. [render.com](https://render.com) 접속 → **New Web Service**
2. GitHub 저장소 연결
3. 설정:
   - **Root Directory**: `backend`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. **Environment Variables** 추가:
   - Key: `ANTHROPIC_API_KEY`
   - Value: 발급받은 API 키
5. Deploy 클릭 → 완료되면 URL 복사 (예: `https://question-coach-xxxx.onrender.com`)

---

## 3단계 — 프론트엔드 URL 수정

`frontend/index.html` 파일 상단의 이 줄을 수정:

```js
// 변경 전
const API_BASE = 'https://여기에-render-url.onrender.com';

// 변경 후 (Render에서 복사한 URL)
const API_BASE = 'https://question-coach-xxxx.onrender.com';
```

---

## 4단계 — GitHub Pages 배포

1. GitHub 저장소 → **Settings** → **Pages**
2. Source: `Deploy from a branch`
3. Branch: `main` / `frontend` 폴더 선택 (또는 root에 올린 경우 root)
4. 저장 → 몇 분 후 링크 생성

> 💡 **팁**: `frontend/index.html`을 저장소 루트의 `index.html`로 올리면 GitHub Pages 설정이 더 간단해요.

---

## 기능 요약

| 레시피 | 평가 기준 | 특이 시각화 |
|--------|-----------|------------|
| 1. 5W1H 변형 | if 조건 포함 여부, 상상력 유발 | — |
| 2. 5-Why | 본질 탐구 깊이 | 왜? 연쇄 흐름 표시 |
| 3. Q-Matrix | 가로×세로 위치, 수준 | 매트릭스 위치 배지 |
| 4. 열린 질문 | 다양한 답 가능 여부 | 열린/닫힌 유형 표시 |

- **평가 모드**: 학생이 질문 입력 → 점수(0~100) + 잘된 점 + 개선 질문 제공
- **생성 모드**: 주제 입력 → 레시피에 맞는 질문 세트 생성
- **세션 히스토리**: 이번 세션 기록 (클릭 시 복원)
