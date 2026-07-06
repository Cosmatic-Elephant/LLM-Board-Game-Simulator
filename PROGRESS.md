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

---

## 2026-06-17 — 세션 4

### 완료한 작업

#### 개인 차례 애니메이션 전면 구현 (CSS only, 외부 라이브러리 없음)

##### 상수 일원화 (`src/app/game/page.tsx` 파일 상단)
```ts
const ROLL_DURATION_MS  = 750;  // 주사위 셔플 총 지속시간
const ROLL_SHUFFLE_MS   = 50;   // 셔플 중 값 변경 간격
const DIE_FADE_MS       = 250;  // 주사위·버튼 페이드 지속시간 (공통)
const DIE_STAGGER_MS    = 100;  // 주사위 순차 등장 간격
```

##### 주사위 순차 페이드 인 (턴 시작)
- n번째 주사위는 `(n-1) * DIE_STAGGER_MS` ms 딜레이 후 `DIE_FADE_MS`ms 동안 페이드 인
- `key={die-${preRollKey}-${idx}}`로 턴마다 CSS 애니메이션 재시작
- `@keyframes fade-in-die` (`globals.css`)

##### 굴리기 버튼 동적 타이밍
- 버튼 페이드 인 시작 = 마지막 주사위 페이드 인 완료 시점: `(diceCount-1)*DIE_STAGGER_MS + DIE_FADE_MS`
- 페이드 인 완료 후에만 클릭 가능 (`rollButtonEnabled` state + `pointerEvents`)

##### 주사위 셔플 애니메이션 (굴리기 버튼 클릭)
- 클릭 즉시 버튼 사라짐, `TurnPhase = "rolling"` 전환
- `setInterval`(50ms)로 전체 주사위가 랜덤값으로 빠르게 교체
- `ROLL_DURATION_MS`(750ms) 후 결과 확정 + `"post-roll"` 전환

##### 카지노 베팅 퇴장 애니메이션
- 카지노 클릭 시 해당 눈의 주사위들이 위로 `3.5rem` 이동 + 페이드 아웃 (`DIE_FADE_MS`ms)
- `@keyframes die-exit` (`globals.css`)
- 연출 완료(`DIE_FADE_MS`ms) 후 차례 전환 로직 실행 (상태 변경 지연)
- `isPlacingDice` state로 연출 중 카지노 클릭 비활성

##### 컴포넌트 변경 (`src/components/DiceRoll.tsx`)
- `fadeInDelay`, `fadeDuration`, `exiting` prop 추가
- `exiting=true` 시 `die-exit` 애니메이션 + `pointerEvents: none`
- 스타일 우선순위: exiting > fadeInDelay > none

---

### 현재 상태

개인 차례 내 모든 애니메이션 (주사위 등장 → 굴리기 → 베팅 퇴장) 구현 완료.  
`npx tsc --noEmit` 에러 없음 확인.  
글로벌 게임 흐름(라운드 종료 → 정산 → 다음 라운드 / 게임 종료)에 대한 애니메이션은 미구현.

---

---

## 2026-06-17 — 세션 5

### 완료한 작업

#### 정산 단계 분리 (`src/lib/scoring.ts`, `src/types/game.ts`)

- **`CasinoRankEvent` 타입** — 카지노 내 순위별 이벤트: `tie-eliminated` / `payout`
- **`ScoringStep` 타입** — 연출 구동용 ordered sequence: `casino-reveal` ×6 + `score-update` ×1
- **`computeCasinoRankEvents()`** — `scoreCasino()` 알고리즘을 미러링해 순위별 이벤트 목록 생성 (내부 함수)
- **`computeScoringSteps()`** — `scoreRound()` 한 번 실행 후 결과를 step 배열로 포장, 각 `casino-reveal` step에 `events` 포함

#### 정산 연출 전체 구현

##### 새 CSS 키프레임 (`src/app/globals.css`)
- `@keyframes dice-sq-exit` — 카지노 내 플레이어 주사위 사각형 페이드 아웃
- `@keyframes bill-exit` — 지폐 페이드 아웃
- `@keyframes score-popup` — 소지금 증가 팝업 (fade-in + 위로 float + fade-out, 1200ms)

##### `ScoringAnimState` 인터페이스 (`src/app/game/page.tsx`)
- `casinoIdx`, `fadingColors`, `winnerColor`, `highlightedBillIdx`, `exitingBillIdx`
- `eliminatedColorsByCasino: Partial<Record<number, Color[]>>` — 카지노 인덱스 키 map (전환 시 리셋하지 않음)
- `exitedBillsByCasino: Partial<Record<number, number[]>>` — 동상
- `tableClearing: boolean` — 최종 테이블 정리 페이즈

##### `runScoringAnimation()` 연출 순서
1. **즉시 반영**: 플레이어 점수·`billDeck`·`nextRound`를 타이머 없이 시작 시점에 적용
2. `displayScores`를 연출 전 점수로 초기화, `finalScoresRef`에 최종값 저장
3. 카지노 1–6 순서대로: 하이라이트 → 동률 배제 fade → 수령자 하이라이트 → 지폐 fade + `displayScores` 증가 + 소지금 팝업 동시 실행
4. `tableClearing: true` 전환 → 전체 카지노 잔여 주사위/지폐 동시 fade out
5. `setScoringAnim(null)` + `setCasinos(EMPTY_CASINOS)` + `setRoundEnded(true)` 원자적 처리

##### Flash 없는 fade 상태 유지
- 페이드 중(`isFading`) → 완료(`isEliminated`) 전환 시 동일한 animation string 유지
- React가 DOM 업데이트를 스킵 → CSS `forwards` fill이 유지되어 opacity:0 동결
- 크로스-카지노 지속: 카지노 전환 후에도 이전 카지노의 eliminated/exited 상태가 map에 보존

##### `Casino.tsx` 새 props
`scoringFadingColors`, `scoringEliminatedColors`, `scoringHighlightedColor`, `scoringHighlightedBillIdx`, `scoringExitingBillIdx`, `scoringExitedBillIndices`, `scoringTableClearing`

#### displayScore 분리 + 스킵 기능

- `displayScores: Record<Color, number>` state — 연출 중에만 PlayerPanel에 전달
- `handleSkipScoring()` — 타이머 전부 취소 + `displayScores` 즉시 동기화 + 라운드 종료
- 정산 진행 중 화면 중앙에 **스킵 버튼** 표시, 연출 종료 시 제거
- `PlayerPanel`에 `displayScore?: number` prop 추가

#### 소지금 증가 팝업

- 지폐 페이드 아웃 시점과 동시에 `scoreDeltaPopups` 업데이트 (`{ amount, key }`)
- `+{금액}` 텍스트가 PlayerPanel 위에서 등장 → float-up → 페이드 아웃 (1200ms)
- `key` 증가로 동일 플레이어 연속 수령 시 애니메이션 재시작

#### 게임 종료 우승자 텍스트

- 최고 점수 플레이어(동점 전원) — "최종 소지금 {금액}으로 {이름} 우승!" 노란색 Bold
- `// TODO: 최종 정산 UI 추가 필요` 주석 제거 및 실제 UI로 대체

#### 굴리기 버튼 즉시 활성

- 기존: 마지막 주사위 페이드 인 완료 후 버튼 페이드 인 + `rollButtonEnabled` gate
- 변경: 주사위 등장 즉시 버튼 표시 + 즉시 클릭 가능 (페이드 인 없음)
- `rollButtonEnabled` state, `rollTimerRef`, `buttonAnimDelay` 전부 제거, `triggerPreRoll` 단순화

#### q키 테스트 단축키 (TEST ONLY)

- `pre-roll`: q → `handleRoll()` / `post-roll`: q → 베팅 가능 카지노 중 랜덤 선택 후 `handleCasinoSelect()`
- `qHandlerRef` 패턴: 빈 deps `useEffect`로 리스너 1회 등록, ref를 매 렌더에 갱신해 stale closure 방지
- 관련 코드에 `// TEST ONLY — delete before release` 주석 명시

#### 기타 정리

- `handleCasinoSelect` 내 베팅 콘솔 로그 제거

---

### 현재 상태

정산 연출 전체(동률 배제 → 순위별 지급 → 테이블 클리어 → 라운드/게임 종료 UI) 완료.  
displayScore 연출, 스킵, 소지금 팝업, 우승자 텍스트 모두 동작 확인.  
`npx tsc --noEmit` 에러 없음 확인.

---

---

## 2026-06-18 — 세션 6

### 완료한 작업

#### sessionStorage 연동 (`src/app/game/page.tsx`)
- 마운트 `useEffect`에서 `sessionStorage("las-vegas-player-config")` 읽기 → 없으면 `INITIAL_PLAYERS` 폴백
- `initialPlayersRef`에 초기 플레이어 목록 저장 (`handleRestart` 재사용)
- TEMP 더미 데이터(4인 중 yellow만 LLM) 주입 코드 삽입 — 로비 구현 전 테스트용 (`// TEMP` 주석)

#### turn 카운터 state 추가 (`src/app/game/page.tsx`)
- `const [turn, setTurn] = useState(0)` 추가
- `handleCasinoSelect` 내 베팅 완료 분기 양쪽에 `setTurn(t => t + 1)` 추가
- `handleNextRound` / `handleRestart`에 `setTurn(0)` 추가

#### LLM 턴 자동 진행 useEffect 구현 (`src/app/game/page.tsx`)
- deps: `[turn, currentPlayerIndex, turnPhase]`
- **pre-roll 페이즈**: `llmIsRunningRef` 중복 방지 후 `LLM_ROLL_DELAY_MS(500ms)` 딜레이 → `handleRoll()` 자동 실행
- **post-roll 페이즈**: `LLM_PLACE_DELAY_MS(500ms)` 후 `/api/llm-action` POST 호출
  - closure에서 `roll` 결과 포착(rollCounts → valid_actions 빌드), `LLMGameState` 페이로드 인라인 빌드
  - 응답 `data.action.dice_count`(snake_case) 읽어 `isValidAction` 재검증
  - 유효 시 `handleCasinoSelect(action.casino)`, 실패/에러 시 첫 번째 valid casino 폴백
- `llmIsRunningRef`: pre-roll에서 set, post-roll cleanup에서 reset — 두 페이즈 브릿지 역할
- `handleNextRound` / `handleRestart`에 `llmIsRunningRef.current = false` 리셋 추가

#### LLM 안전장치 (`src/app/game/page.tsx`, `src/components/Casino.tsx`)
- 굴리기 버튼: `current.isLLM` 이면 `invisible pointer-events-none`
- `casinoSelectable()`: `current.isLLM` 이면 즉시 `false` 반환
- Casino.tsx `onMouseEnter` 게이트 제거 → hover 하이라이팅은 LLM 턴에도 유지
- 함수 자체(`handleRoll`, `handleCasinoSelect`)는 내부 차단 없음 — UI 레이어에서만 차단

#### 직렬화 버그 수정 (`src/app/api/llm-action/route.ts`, `src/lib/llm-client.ts`)
- route.ts: `response.action`(snake_case `dice_count`)을 그대로 반환 — 이전엔 camelCase `action` 반환해 client에서 `dice_count`가 `undefined`가 되는 버그 존재
- llm-client.ts `parseResponse`: LLM이 camelCase `diceCount`를 반환한 경우 `dice_count`로 정규화
- llm-client.ts 시스템 프롬프트: `"dice_count"` 필드명 사용을 명시적으로 강조

#### 응답 속도 개선 (`src/lib/llm-client.ts`)
- Anthropic `max_tokens`: 512 → 150
- OpenAI `max_tokens`: 512 → 150
- Google `maxOutputTokens`: 512 → 150

---

### 현재 상태

LLM 연동 동작 확인 완료 (yellow 플레이어가 주사위 굴리기·카지노 선택 자동 진행).  
LLM 턴 중 인간 조작 UI가 차단되고, hover 하이라이팅은 유지된다.  
`npx tsc --noEmit` 에러 없음 확인.

---

---

## 2026-06-19 — 세션 7 (완료)

### 완료한 작업

#### 라운드 시작 플레이어 랜덤 섞기 (`src/app/game/page.tsx`)

- **`shufflePlayers(players, humanFirst)` 함수** — Fisher-Yates 셔플, `humanFirst=true` 시 인덱스 0이 LLM이면 첫 번째 인간과 스왑
- 마운트 `useEffect`, `handleNextRound`, `handleRestart` 모두 `shufflePlayers` 통과

#### 나가기 플로팅 버튼 (`src/app/game/page.tsx`)

- `fixed right-4 bottom-28` 원형 버튼 + `exit.png` 아이콘
- 클릭 시 "메인 화면으로 돌아가시겠습니까?" 확인 팝업 노출

#### 로비 페이지 전면 재작성 (`src/app/page.tsx`)

- 브라우저 탭 타이틀: `LLM 보드게임` (layout.tsx)
- 홈 화면: **게임 변경** + **게임 시작** 버튼 나란히, 설명 문구 "주사위를 굴려서 베팅하는 보드게임"
- **게임 시작 버튼 → 설정 팝업** 노출
  - 플레이어 슬롯 4개: 색상 / 이름(또는 모델) / AI 토글
  - 게임 설정: 사람이 먼저 플레이 토글, 지폐 배치 커트라인 셀렉트박스
  - 하단 버튼: **기본값으로** / **튜토리얼** / **게임 시작**
- **가드레일**
  - 색상 중복 방지: 다른 슬롯이 선택한 색상은 `ColorSelect`에서 disabled 처리
  - 빈 이름 자동 채움: AI 토글 off인 슬롯 이름이 비어있으면 `플레이어 n`으로 채움
  - 전원 AI 시 `humanFirst` 토글 비활성화(시스템상 `false` 처리, UI 값 유지)
- **오버레이 닫힘 개선**: `mouseDownOutsideRef` 패턴 — 팝업 외부에서 mousedown + mouseup이 모두 발생한 경우에만 닫힘

#### 색상 상수 추출 (`src/lib/constants.ts` 신규)

- `PLAYER_COLORS` 배열 8색: `key` / `label(한글)` / `hex` 필드
- `ColorKey` 타입 export

#### Color 타입 8색 확장 (`src/types/game.ts`)

- `"red" | "yellow" | "green" | "blue"` → 4색 추가: `"orange" | "purple" | "pink" | "white"`
- 영향 파일: `bill-setup.ts`, `game-engine.ts`, `Casino.tsx`, `PlayerPanel.tsx`, `DiceRoll.tsx` 모두 갱신

#### 커스텀 색상 드롭다운 (`ColorSelect`)

- native `<select>`는 `<option>` 내 HTML 렌더 불가 → div 기반 완전 커스텀 드롭다운
- 색상 원형 dot + 한글 이름 함께 표시, taken 색상 disabled 스타일 처리

#### 로비 ↔ 게임 페이지 설정 연동

- `las-vegas:playerConfig` / `las-vegas:gameSettings` 두 키로 **localStorage**에 저장
- 팝업이 열릴 때 localStorage에서 불러와 적용; 설정 변경 시마다 자동 저장
- **기본값으로** 버튼: DEFAULT_PLAYERS + humanFirst=true + cutline=50000, localStorage도 덮어씀
- `distributeRound()`에 `cutline` 파라미터 추가 (기본값 50000)
- `shufflePlayers()`에 `humanFirst: boolean` 파라미터 추가
- game/page.tsx: 마운트 시 localStorage 읽어 플레이어 구성·설정 적용, fallback은 4색 기본 플레이어
- `humanFirstRef` / `cutlineRef`로 ref 유지 — 라운드 재시작 시에도 설정값 보존

#### 버그 수정

- `Casino.tsx` `COLOR_ORDER`: 4색 → 8색 (새 색상 플레이어 주사위가 카지노에 미표시되던 문제)
- `DiceRoll.tsx` `PLAYER_BG`: 4색 → 8색 (새 색상 플레이어 주사위가 모두 회색으로 보이던 문제)
- `INITIAL_PLAYERS` 상수 제거: useEffect가 localStorage에서 읽으므로 불필요, fallback 인라인 처리

---

### 현재 상태

로비 → 게임 전체 흐름 연결 완료. 플레이어 설정(색상·이름·AI 여부·모델)과 게임 설정(humanFirst·cutline)이 localStorage를 통해 게임 페이지에 전달된다.  
`npx tsc --noEmit` 에러 없음 확인.

---

### 미결 사항

- [ ] q키 테스트 단축키 — 최종 배포 전 삭제 필요 (`// TEST ONLY` 주석 위치)
- [ ] 에러 핸들링: LLM API 키 미설정, API 호출 실패 시 사용자 안내
- [ ] `npm audit` 경고 — Next.js 내부 postcss 취약점이나, `npm audit fix --force`하면 Next.js 9.x로 역행하므로 보류 중. Next.js 업스트림 패치 대기

---

---

## 2026-06-30 — 세션 8

### 완료한 작업

#### 말풍선(Speech Bubble) 시스템 (`src/app/game/page.tsx`, `src/app/globals.css`)

- 베팅 직후 해당 플레이어 패널 위에 말풍선 3초간 표시
  - 인간/깡통: "n번 카지노에 베팅했어요."
  - LLM: "n번 카지노에 베팅했어요. {reasoning}"
- `BubbleTimerInfo { timerId | null, remainingMs, startedAt }` 구조를 `bubbleTimersRef`(Ref)로 관리
- **Hover-pause**: 마우스를 올리면 카운트다운 일시정지, 벗어나면 남은 시간부터 재개
- hover 중 같은 플레이어의 말풍선을 다시 띄울 경우 즉시 교체
- `handleCasinoSelect(n, reasoning?)` — optional reasoning 파라미터 추가, LLM effect에서 전달
- 정산 시작·스킵·다음 라운드·재시작 시 말풍선 전부 클리어
- `@keyframes bubble-in` CSS 추가 (opacity + translateY 슬라이드인 200ms)

#### LLM parseResponse 버그 수정 (`src/lib/llm-client.ts`)

- **원인**: `max_tokens: 150`이 너무 낮아 JSON 출력 전 산문 분석 중에 응답이 잘림
- `{[\s\S]*}` 정규식으로 raw text에서 JSON 객체만 추출해 앞뒤 산문을 허용하도록 개선
- 파싱 실패 시 `console.warn`으로 raw text 전체 로깅 추가

#### LLM 시스템 프롬프트 개선 (`src/lib/llm-client.ts`, `DESIGN.md`)

세션 전반에 걸쳐 프롬프트를 여러 차례 수정했다. 공통된 방향은 두 가지였다. 하나는 **LLM이 JSON 앞에 장황한 분석 텍스트를 쓰지 않도록** 형식 지시를 강화하는 것, 다른 하나는 **전략적 판단 근거를 프롬프트 안에 심어** 무작위에 가까운 선택을 줄이는 것이다.

- `max_tokens` 150 → 512 → 700으로 단계적 조정 (너무 낮으면 JSON이 잘리고, 형식 지시 강화와 병행해 최적값 탐색)
- Output Format 섹션 재작성: JSON만 출력하라는 지시 강화, reasoning은 1-2문장·한국어로 제한, "빠르게 직관적으로 결정하라" 톤으로 교체
- **Strategy 섹션 신규 추가**: Dice efficiency / Spreading risk / Tie exploitation 세 가지 원칙. Tie exploitation은 "타이 상태 플레이어는 이미 탈락이므로 경쟁 상대가 아님"을 명확히 기술

#### LLM single valid action 최적화 (`src/app/game/page.tsx`)

- `valid_actions.length === 1`(롤 결과 눈금이 하나뿐)이면 `/api/llm-action` 호출 생략, 즉시 선택
- `SINGLE_ACTION_PHRASES` 5개 한국어 문구 중 랜덤 선택해 reasoning으로 말풍선 표시
- `깡통` 모델 분기보다 앞에 위치하므로 모든 LLM 플레이어에 일괄 적용

---

### 현재 상태

말풍선 시스템, LLM 프롬프트 개선, 단일 액션 최적화 모두 구현 완료.  
LLM이 reasoning을 말풍선에 한국어로 표시하며 동작 확인.

---

### 미결 사항

- [ ] q키 테스트 단축키 — 최종 배포 전 삭제 필요 (`// TEST ONLY` 주석 위치)
- [ ] 에러 핸들링: LLM API 키 미설정, API 호출 실패 시 사용자 안내
- [ ] `npm audit` 경고 — Next.js 내부 postcss 취약점이나, `npm audit fix --force`하면 Next.js 9.x로 역행하므로 보류 중. Next.js 업스트림 패치 대기

---

---

## 2026-07-02 ~ 2026-07-06 — 세션 9 (완료)

### 완료한 작업

#### 로비 버튼 구조 개편 (`src/app/page.tsx`)

- **게임 시작 버튼 → 싱글플레이 / 멀티플레이 두 버튼으로 분화** (둘 다 노란색 활성 스타일)
- **게임 변경 버튼 위치 이동**: 타이틀 아래 → `absolute bottom-6` 화면 하단 중앙으로 이동, 크기·색상 소폭 조정(서브 액션 강조)
- `<main>` 에 `relative` 추가 (절대 위치 기준점)

#### Socket.io 기본 연결 설정

- **패키지 설치**: `socket.io ^4.8.3`, `socket.io-client ^4.8.3`, `tsx ^4.22.4` (devDep)
- **커스텀 서버 (`server.ts`, 루트 신규)** — Next.js HTTP 서버를 직접 생성 후 `socket.io`를 얹는 구조. 연결/해제 콘솔 로그. 포트는 `process.env.PORT` 또는 기본값 3000
- **`package.json` dev 스크립트 변경**: `next dev` → `tsx server.ts`
- 참고: 이후 작업에서 멀티플레이 팝업 UI 흐름을 먼저 완성하는 방향으로 진행했고, 팝업 내부에서 실제 소켓 연결/룸 로직은 아직 붙이지 않았다 (`server.ts`는 현재 미사용 상태로 대기 중, TODO로 남겨둠).

#### 싱글/멀티 플레이어 설정 팝업 분리

- 기존 플레이어 설정 팝업을 `PlayerSetupPopup({ title, onClose })` 컴포넌트로 추출, 타이틀을 "싱글 플레이어 설정"으로 변경
- 오버레이(딤드 영역) 클릭으로 팝업이 닫히는 동작 제거 — X 버튼으로만 닫힘
- 공용 `PopupHeader({ title, onClose })` 컴포넌트 추출

#### 멀티플레이 진입 팝업 (`MultiplayerPopup`)

- `step` state(`"entry" | "host-settings" | "guest-settings" | "not-found"`)로 화면 전환을 **레이어 스택이 아닌 교체 방식**으로 관리
- 이름 입력 필드(로컬스토리지 `las-vegas:multiplayerName`에 영속화) + 구분선 + "방 만들기"(→ host-settings) + 초대 URL 입력(Enter 키로도 제출) + "참가하기" 버튼
- "참가하기": 입력값이 `validroom`이면 guest-settings, 그 외에는 "방을 찾을 수 없습니다." + "돌아가기"(entry 복귀) 화면
- X 버튼은 항상 팝업 전체를 완전히 닫는다 (entry로 되돌리지 않음)

#### 멀티플레이 방 설정 팝업 — 호스트/게스트 분화 (`MultiplayerRoomPopup`)

와이어프레임(요소 배치만 참고, 텍스트는 기존 앱 용어에 맞춤)을 기반으로 구현:

- 공통: 플레이어 이름 필드는 호스트/게스트 모두 읽기 전용, AI 토글 → 클릭 무반응 원형 `AIBadge`로 교체, "URL 복사" 버튼은 양쪽 다 활성화(`navigator.clipboard.writeText(window.location.href)`)
- 호스트: 모든 슬롯 색상 편집 가능(`ColorSelect`), 게임 설정 편집 가능, "기본값으로"/"게임 시작" 버튼 활성
- 게스트: 본인 슬롯(`GUEST_OWN_SLOT_INDEX` — 현재 1로 하드코딩, 추후 입장 순서 기반 동적 배정 예정)만 색상 편집 가능(`ColorSelect`), 나머지는 `ColorDisplay`(읽기 전용), 게임 설정은 `ReadOnlyBox`/`disabled` Toggle, "기본값으로"/"게임 시작"은 `disabled` + `disabled:cursor-not-allowed`
- 팝업 타이틀: 호스트는 `"{이름}의 멀티플레이 방"`, 게스트는 고정 문구 `"멀티플레이 방"` (호스트 이름을 아직 알 수 없으므로 — 실제 Socket.io 연동 시 서버에서 받아와 교체 예정, 코드에 주석 명시)
- `handleStartGame()`은 현재 no-op (`// TODO: 실제 Socket.io 연동 시 방 정보 전송`)

#### 버그 수정 — `las-vegas:multiplayerName` 로컬스토리지 초기화 문제

- **증상**: 멀티플레이 버튼 클릭 시 저장된 이름이 있어도 항상 "플레이어"로 덮어써짐
- **원인**: 불러오기(load) `useEffect([])`와 저장(save) `useEffect([name])`를 분리한 구조에서, Next.js 개발 모드의 React Strict Mode 이중 마운트 특성상 save effect가 아직 load effect의 `setName` 반영 전 렌더(기본값 "플레이어")를 기준으로 먼저 로컬스토리지를 덮어쓰는 경합이 발생
- **수정**: load effect를 제거하고 `useState`의 lazy initializer에서 로컬스토리지를 직접 읽도록 변경 (`() => localStorage.getItem(STORAGE_MULTIPLAYER_NAME_KEY) ?? "플레이어"`). 이 팝업은 버튼 클릭 후에만 마운트되어 SSR 대상이 아니므로 안전함
- Playwright로 저장값 유지 케이스/기본값 케이스 모두 검증 완료

#### 검증

- `npx tsc --noEmit`, `npx eslint src/app/page.tsx` 모두 통과
- Playwright(임시 설치 후 검증·정리)로 진입→호스트 설정, 진입→invalid room→돌아가기, 진입→validroom(Enter 키)→게스트 설정 전체 흐름 스크린샷 확인, 콘솔 에러 없음 확인
- 검증에 사용한 임시 스크립트·`playwright` 패키지는 모두 정리, `package-lock.json`은 `npm install`로 재생성해 깨끗한 상태 유지

---

### 현재 상태

로비의 싱글/멀티플레이 진입 팝업과, 멀티플레이 방 설정 팝업의 호스트/게스트 UI 분화가 모두 완료되었다.  
실제 Socket.io 방 생성/참가/동기화 로직은 아직 연결되지 않았고, `server.ts`의 기본 연결 테스트 코드도 현재는 페이지에서 호출되지 않는 대기 상태다.  
`npx tsc --noEmit` 에러 없음 확인.

---

### 미결 사항 (누적)

- [ ] q키 테스트 단축키 — 최종 배포 전 삭제 필요 (`// TEST ONLY` 주석 위치)
- [ ] 에러 핸들링: LLM API 키 미설정, API 호출 실패 시 사용자 안내
- [ ] `npm audit` 경고 — Next.js 내부 postcss 취약점이나, `npm audit fix --force`하면 Next.js 9.x로 역행하므로 보류 중. Next.js 업스트림 패치 대기
- [ ] 멀티플레이 실제 Socket.io 연동: 방 생성/참가, 게임 상태 동기화 (`MultiplayerRoomPopup.handleStartGame` TODO)
- [ ] 게스트 슬롯 동적 배정: 현재 `GUEST_OWN_SLOT_INDEX = 1` 하드코딩 → 입장 순서 기반으로 교체 예정
- [ ] 게스트 화면 방 타이틀: 현재 고정 문구 "멀티플레이 방" → 서버에서 호스트 이름 받아와 표시하도록 교체 예정

---

### 다음 세션 예정 작업

- 멀티플레이 Socket.io 이벤트 설계 (방 생성/참가/퇴장, 슬롯 배정, 설정 동기화)
- `MultiplayerRoomPopup` ↔ 서버 상태 실시간 연동
- 멀티플레이 게임 진행 로직 (game/page.tsx와의 연결 방식 설계 포함)
