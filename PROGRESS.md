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

## 2026-06-15 — 세션 2

### 완료한 작업

#### 규칙 수정
- `DESIGN.md` 카지노 빌 배치 기준선 100,000 → **50,000**으로 변경
- `src/lib/bill-setup.ts` 내 `distributeRound()` 누적 임계값도 동일하게 반영

#### 메인 페이지 (`src/app/page.tsx`)
- 타이틀 하단에 **[게임 시작]** 버튼 추가 (`/game`으로 이동, `next/link`)

#### 게임 화면 UI 컴포넌트 신규 구현
- **`src/components/DiceRoll.tsx`** — `Die` 컴포넌트
  - 3×3 pip 그리드로 1~6 주사위 눈 렌더링 (PIP_MAP)
  - `value=0` 전달 시 빈 주사위(눈 없음) 표시 — pre-roll 상태에 활용
  - 호버 시 `onHover(face)` 콜백으로 매칭 카지노 하이라이팅
- **`src/components/Casino.tsx`** — `Casino` 컴포넌트
  - 플레이어별 색상 사각형으로 배치된 주사위 수 표시
  - 빌 스택을 카지노 하단에 gap-1 간격으로 렌더링 (색상은 금액별로 구분)
  - `canPlace` (밝기) / `selectable` (클릭 가능) prop을 **분리**해 pre-roll 상태 표현
  - 호버 → `onHover`, 클릭 → `onSelect` 콜백
- **`src/components/PlayerPanel.tsx`** — `PlayerPanel` 컴포넌트
  - 플레이어 이름·색상·남은 주사위 수·소지금 표시
  - 현재 턴 플레이어: 컬러 테두리 + `-translate-y-1.5` 강조
  - `isThinking` prop (현재 미사용, LLM 연동 시 활성화 예정)

#### 게임 보드 페이지 (`src/app/game/page.tsx`)
- 6개 카지노(상단) / 주사위 영역(중앙) / 플레이어 패널(하단) 레이아웃 구성
- 주사위 영역은 화면 중앙 정렬, 라운드 숫자는 `absolute right` 고정
- 카지노 ↔ 주사위 **양방향 호버 하이라이팅**: 카지노 호버 시 해당 눈 Die 강조, Die 호버 시 해당 번호 카지노 강조

#### 게임 로직 (UI 레벨, 상태 기계 미연결)
- **`generateRoll()`** — 1~6 랜덤 8개 생성 후 오름차순 정렬
- **Hydration 에러 수정** — `Math.random()` SSR/클라이언트 불일치 문제. `useState([])` + 굴리기 버튼 클릭 시 생성으로 해결
- **턴 상태 머신** (`TurnPhase: "pre-roll" | "post-roll"`)
  - `pre-roll`: 빈 주사위 8개, 굴리기 버튼 표시, 모든 카지노 밝음(클릭 비활성)
  - `post-roll`: 실제 눈 렌더링, 굴리기 버튼 숨김, 매칭 카지노만 밝음+클릭 활성
- **플레이어 순환** — 카지노 클릭 시 `currentPlayerIndex` 증가 (mod 4), 상태 초기화 후 다음 플레이어 pre-roll 시작
- **베팅 콘솔 로그** — `"n번 카지노에 [color] 주사위 m개가 베팅되었음"` (동적 플레이어 색상 반영)
- 현 단계에서 LLM 분기 없음 — 모든 플레이어 동일하게 인간 턴 처리

---

### 현재 상태

UI 구조와 턴 흐름(굴리기 → 카지노 선택 → 다음 플레이어) 동작 확인 완료.  
카지노 클릭 시 콘솔 로그만 출력되고, **실제 GameState 변경은 아직 미연결**이다.

---

## 2026-06-15 — 세션 3

### 완료한 작업

#### DESIGN.md 보완
- 지폐 커트라인 기본값(50,000)을 게임 시작 전 옵션에서 변경 가능한 설정값으로 명시
- 지폐 금액별 컬러코드 테이블 추가 (`#6FCF97` ~ `#F9E74A`)

#### Casino.tsx 업데이트
- Tailwind 색상 클래스 → DESIGN.md hex 컬러코드 인라인 스타일로 교체

#### game/page.tsx 대규모 업데이트
- 하드코딩 더미 주사위·소지금·라운드 데이터 전면 제거
- `useEffect`로 마운트 시 `distributeRound()` 호출 — SSR hydration 충돌 방지
- `billDeck` state 추가 (초기값 = `distributeRound`의 `remainingDeck`, 이후 반환 지폐 합산)
- 카지노 클릭 시 실제 상태 연결
  - 해당 카지노 `dice`에 현재 플레이어 색상·개수 추가
  - 현재 플레이어 `diceRemaining` 차감
  - `diceRemaining = 0`인 플레이어 턴 자동 스킵
- 라운드 종료 감지: 전원 `diceRemaining = 0` → `scoreRound()` 호출
  - 정산 결과 각 플레이어 `score`에 누적, 반환 지폐 `billDeck`에 추가
  - 정산 직후 `distributeRound(updatedDeck)` 선제 호출 → `nextRound` state 저장
- 라운드 종료 버튼 흐름
  - `nextRound` 있음: **다음 라운드** + 게임 종료
  - `nextRound` 없음(지폐 부족): 게임 종료만
- **다음 라운드**: 주사위 전원 반환, `round + 1`, 선제 계산된 카지노 배치 적용
- **게임 종료**: `gameOver = true` → **메인화면으로** / **다시하기** 버튼 노출
  - `// TODO: 최종 정산 UI 추가 필요` 주석 삽입
- 라운드 정보 표시 형식: `"n라운드 | 남은 지폐 m장"`

#### PlayerPanel.tsx 업데이트
- `isThinking` prop 제거
- "생각 중..." 표기를 패널 내부 → 패널 위로 이동 (현재 턴 플레이어에게 항상 표시, LLM 여부 무관)

#### UI 세부 개선
- 굴리기 버튼 주사위 아래 별도 행 배치 (`invisible`로 공간 유지 → 주사위 위치 고정)
- 롤 후 주사위 그룹화: 같은 눈 내부 `gap-2`, 그룹 간 `gap-4`
- 굴리기 시 현재 플레이어의 `diceRemaining`만큼만 주사위 생성

#### bill-setup.ts 가드레일 추가
- 카지노당 최대 배치 지폐 수 = 플레이어 수(`activeColors.length`)
- 커트라인 미달성 시에도 인원 수 도달 시 즉시 다음 카지노로 이동

---

### 현재 상태

배팅 → 라운드 종료 → 정산 → 다음 라운드 / 게임 종료 전체 흐름 동작 확인.  
`scoring.ts`·`bill-setup.ts`는 게임 화면에서 직접 호출.  
`game-engine.ts`의 `applyRoll()` / `applyAction()` / `applyScoring()`은 미연결 상태이며, 향후 LLM 연동 시 활용 예정.

---

## 다음 세션에서 이어할 작업

### 우선순위 높음
1. **시작 플레이어 선택** — 현재 항상 플레이어 1(index 0)이 먼저 시작.  
   매 라운드 랜덤 또는 규칙 기반(이전 라운드 마지막 플레이어, 최소 소지금 등)으로 결정해야 함.

2. **로비 페이지** (`src/app/page.tsx`)
   - 플레이어 수 선택 (2~4명)
   - 각 플레이어: 인간 / LLM 선택, 색상 선택, LLM이면 모델 ID 입력
   - 설정 완료 후 `/game`으로 초기 설정 전달

3. **LLM 턴 자동 진행** — LLM 플레이어 차례에 `/api/llm-action` 호출 후 자동 액션 적용
   - "생각 중..." UI 표시 중 버튼/클릭 비활성

### 우선순위 보통
4. **최종 정산 UI** — `game/page.tsx`의 `TODO` 주석 위치에 구현. 플레이어별 최종 순위·소지금 표시
5. **라운드별 정산 결과 표시** — 현재 콘솔 로그만 출력. 카지노별 지급 결과를 화면에 표시

### 미결 사항
- [ ] `reasoning` 문자열을 화면에 표시할지 여부 (디버깅 목적)
- [ ] 에러 핸들링: LLM API 키 미설정, API 호출 실패 시 사용자 안내
- [ ] `npm audit` 경고 — Next.js 내부 postcss 취약점이나, `npm audit fix --force`하면 Next.js 9.x로 역행하므로 보류 중. Next.js 업스트림 패치 대기
