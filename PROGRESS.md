# 작업 진행 기록

---

## 2026-06-14 — 세션 1

### 완료한 작업

#### 프로젝트 초기 세팅
- `package.json` 직접 작성 (폴더명에 한글/공백이 있어 `create-next-app` 사용 불가)
- Next.js 15.3.4+, TypeScript, Tailwind CSS v4, Anthropic/OpenAI/Google SDK 설치
- 설정 파일 생성: `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `.gitignore`, `.env.local.example`

#### 타입 정의 (`src/types/game.ts`)
- `Color`, `CasinoNumber` 기본 타입
- `PlayerConfig`, `PlayerState`, `CasinoState`, `Action`
- `GamePhase` (lobby → round-setup → rolling → awaiting-action → scoring → round-end → game-end)
- `GameState` (내부 상태 기계)
- `LLMGameState`, `LLMResponse` (DESIGN.md JSON 스키마와 1:1 대응)
- `CasinoScoreResult`, `RoundScoreResult` (정산 결과)

#### 빌 분배 로직 (`src/lib/bill-setup.ts`)
- `createBillDeck()` — DESIGN.md 명세대로 54장 생성
- `shuffle<T>()` — Fisher-Yates 셔플
- `distributeRound()` — 6개 카지노에 빌 분배, 합계 ≥ 100,000 될 때까지 누적, 빌 부족 시 `null` 반환

#### 정산 로직 (`src/lib/scoring.ts`)
- `scoreCasino()` — 같은 주사위 수 플레이어 전원 탈락, 순위별 빌 지급, 수령자 없는 빌 반환
- `scoreRound()` — 전체 6개 카지노 정산 집계

#### 게임 엔진 (`src/lib/game-engine.ts`)
- `rollDice()`, `groupDice()`, `getValidActions()` — 주사위 관련 유틸
- `createInitialState()` — 초기 게임 상태 생성
- `setupRound()` — 빌 분배 + 시작 플레이어 랜덤 선택 (빌 부족 시 game-end)
- `applyRoll()` — 롤 결과 기록, phase → awaiting-action
- `applyAction()` — 주사위 배치, 다음 플레이어로 이동 또는 scoring으로 전환
- `applyScoring()` — 정산 실행, 점수 반영, 반환 빌 deck에 추가
- `buildLLMPayload()` — LLM 전송용 JSON 페이로드 생성
- `isValidAction()` — LLM 응답 액션 유효성 검증
- `getRankings()` — 점수 내림차순 정렬

#### LLM 클라이언트 (`src/lib/llm-client.ts`)
- Anthropic / OpenAI / Google 멀티 프로바이더 지원 (modelId 접두사로 자동 감지)
- DESIGN.md의 시스템 프롬프트 내장
- `parseResponse()` — JSON 파싱 실패 시 첫 번째 valid_action으로 폴백
- `getLLMAction()`, `llmResponseToAction()` 공개 API

#### App 라우팅
- `src/app/layout.tsx` — 루트 레이아웃 (dark 배경)
- `src/app/page.tsx` — 로비 플레이스홀더
- `src/app/game/page.tsx` — 게임 보드 플레이스홀더
- `src/app/api/llm-action/route.ts` — LLM 호출 + 서버사이드 액션 재검증 POST 엔드포인트

#### 검증
- `npx tsc --noEmit` 에러 없음 확인

---

### 현재 상태

게임 엔진 로직과 타입 정의 완료. UI가 없어 화면에 아무것도 표시되지 않는 상태. 다음 단계는 UI 컴포넌트 구현이다.

---

## 다음 세션에서 이어할 작업

### 우선순위 높음
1. **로비 페이지** (`src/app/page.tsx`)
   - 플레이어 수 선택 (2~4명)
   - 각 플레이어: 인간 / LLM 선택, 색상 선택, LLM이면 모델 ID 입력
   - "게임 시작" 버튼 → `/game`으로 이동

2. **게임 상태 관리**
   - `useGameState` 커스텀 훅 또는 Context 설계
   - `setupRound` → `applyRoll` → `applyAction` → `applyScoring` 흐름을 React와 연결

3. **게임 보드 UI** (`src/app/game/page.tsx` + 컴포넌트)
   - `Casino.tsx` — 카지노별 빌 스택, 색상별 주사위 수 표시
   - `PlayerPanel.tsx` — 플레이어 정보 (색상, 점수, 남은 주사위 수)
   - `DiceRoll.tsx` — 현재 롤 결과 표시, valid_actions 선택 UI

### 우선순위 보통
4. **LLM 턴 자동 진행** — LLM 플레이어 차례에 `/api/llm-action` 호출 후 자동 액션 적용
5. **라운드 결과 모달** — 라운드 종료 시 카지노별 정산 결과 표시
6. **게임 종료 화면** — 최종 순위와 점수 표시

### 미결 사항
- [ ] 시작 플레이어 선택 방식: 현재는 랜덤. DESIGN.md는 "이전 라운드 마지막 플레이어 또는 최소 금액 플레이어"를 미래 옵션으로 언급함
- [ ] LLM 응답 로딩 중 UI 처리 (스피너 등)
- [ ] `reasoning` 문자열을 화면에 표시할지 여부 (디버깅 목적)
- [ ] 에러 핸들링: LLM API 키 미설정, API 호출 실패 시 사용자 안내
- [ ] `npm audit` 경고 — Next.js 내부 postcss 취약점이나, `npm audit fix --force`하면 Next.js 9.x로 역행하므로 보류 중. Next.js 업스트림 패치 대기
