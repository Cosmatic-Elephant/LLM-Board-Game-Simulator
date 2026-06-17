# Las Vegas Simulator — Claude Code Guide

## 프로젝트 개요

라스베가스(주사위 배치 보드게임) 시뮬레이터. 최대 4명의 플레이어가 인간 또는 LLM 어느 조합으로든 참여할 수 있다. 목적은 외부 LLM API 연동 실습이며, 로컬 실행 전용이다.

- 게임 규칙과 JSON 스키마 전체는 `DESIGN.md`를 참조한다.
- 배포는 의도하지 않는다 (`npm run dev` 로컬 전용).

---

## 기술 스택

| 항목 | 선택 |
|------|------|
| 프레임워크 | Next.js 15 (App Router) |
| 언어 | TypeScript (strict) |
| 스타일링 | Tailwind CSS v4 |
| LLM SDK | `@anthropic-ai/sdk`, `openai`, `@google/genai` |
| 런타임 | Node.js 24 / 로컬 전용 |

---

## 폴더 구조

```
/
├── DESIGN.md                    # 게임 규칙 · LLM 페이로드 스키마 원본 (변경 금지)
├── CLAUDE.md                    # 이 파일 — Claude Code 가이드
├── PROGRESS.md                  # 세션별 작업 진행 기록
├── .env.local.example           # 환경변수 템플릿 (실제 키는 .env.local에)
├── src/
│   ├── types/
│   │   └── game.ts              # 모든 TypeScript 타입 정의
│   ├── lib/
│   │   ├── bill-setup.ts        # 빌 덱 생성 · 라운드별 카지노 분배
│   │   ├── scoring.ts           # 라운드 정산 (타이 제거 포함)
│   │   ├── game-engine.ts       # 게임 상태 기계 전체
│   │   └── llm-client.ts        # 멀티 프로바이더 LLM 클라이언트
│   ├── components/
│   │   ├── Casino.tsx           # 카지노 카드 (지폐 스택 · 주사위 배치 표시)
│   │   ├── PlayerPanel.tsx      # 플레이어 정보 패널 (소지금 · 주사위 수 · 활성 강조)
│   │   └── DiceRoll.tsx         # Die 컴포넌트 (3×3 pip 그리드, value=0 이면 빈 주사위)
│   └── app/
│       ├── globals.css
│       ├── layout.tsx
│       ├── page.tsx             # 로비 (미구현 — 플레이어 설정 예정)
│       ├── game/
│       │   └── page.tsx         # 게임 보드 (배팅·정산·라운드 전환 동작 중)
│       └── api/
│           └── llm-action/
│               └── route.ts     # LLM 호출 API 엔드포인트 (서버 전용)
```

---

## 주요 설계 결정

### 1. 불변(Immutable) 상태 기계

`src/lib/game-engine.ts`의 모든 `apply*` 함수는 상태를 직접 변경하지 않는다. 내부에서 `JSON.parse(JSON.stringify(state))`로 deep clone 후 반환한다. React 상태 관리를 단순하게 유지하기 위한 선택이다.

```
setupRound → applyRoll → applyAction → (반복) → applyScoring → setupRound …
```

### 2. 게임 종료 시그널

`distributeRound()`가 `null`을 반환하면 빌이 부족한 것이므로 호출자가 phase를 `"game-end"`로 전환한다. 별도 예외를 던지지 않는다.

### 3. LLM 액션 서버사이드 검증

LLM 응답은 클라이언트가 아닌 `/api/llm-action` 라우트에서 `isValidAction()`으로 재검증된다. LLM이 `valid_actions` 밖의 액션을 반환하면 `422`를 돌려준다.

### 4. 멀티 프로바이더 자동 감지

`llm-client.ts`는 `modelId` 접두사로 프로바이더를 자동 판별한다:
- `claude*` → Anthropic
- `gpt*` / `o1*` / `o3*` → OpenAI
- `gemini*` → Google

SDK는 동적 import(`await import(...)`)로 지연 로드하므로 사용하지 않는 프로바이더의 패키지가 빌드에 포함되어도 서버 시작 비용이 없다.

### 5. 타이 제거 스코어링

`scoreCasino()`는 같은 주사위 수를 가진 플레이어를 해당 랭크에서 전원 제거한다. 상위 랭크 타이만 제거되며 그 아래 플레이어들은 정상 정산된다. (`DESIGN.md` 예시: Red 3 / Green 3 / Yellow 1 → Yellow만 1등 수령)

### 6. `CasinoNumber` 타입

`1 | 2 | 3 | 4 | 5 | 6` 유니온 타입으로 정의되어 있다. `Record<CasinoNumber, CasinoState>` 를 생성할 때 `Object.fromEntries` + 캐스팅 대신 명시적 루프를 사용해야 TypeScript 에러가 없다.

### 7. 카지노 지폐 장수 상한 (가드레일)

`distributeRound()`는 커트라인 금액 도달 여부와 무관하게, 배치 지폐 수가 `activeColors.length`(= 플레이어 수)에 도달하면 다음 카지노로 넘어간다. 커트라인을 높게 설정할 경우 지폐가 무제한 쌓이는 것을 방지한다.

### 8. SSR Hydration 안전 처리

`Math.random()`을 포함하는 초기화 로직(지폐 배치, 주사위 생성)은 모두 `useEffect` 또는 버튼 이벤트 핸들러 안에서만 실행한다. SSR 단계에서는 빈 상태를 렌더링하고, 클라이언트 마운트 후 상태를 채워 hydration 불일치를 방지한다.

### 9. 다음 라운드 배치 선제 계산

`runScoringAnimation()` 진입 시점에 `distributeRound()`를 즉시 호출해 결과를 `nextRound` state에 저장한다. UI는 이 값의 null 여부로 "다음 라운드" 버튼 노출 여부를 결정하며, 사용자가 버튼을 누를 때는 이미 계산된 결과를 그대로 적용한다. 스킵 기능 추가로 인해 애니메이션 종료 콜백이 아닌 시작 시점으로 앞당겼다.

### 10. 연출 즉시 적용 원칙

`runScoringAnimation()` 시작 시 실제 게임 상태(플레이어 점수·`billDeck`·`nextRound`)를 **즉시** 최종값으로 반영한다. 연출 타이머가 하나씩 실제 상태를 변경하는 구조가 아니므로, 스킵·재시작 등 어느 시점에 중단해도 데이터 일관성이 보장된다.

### 11. displayScore 분리

`players[].score`는 정산 시작 즉시 최종값으로 업데이트된다. PlayerPanel에는 연출 진행 중에만 `displayScores: Record<Color, number>` state를 `displayScore` prop으로 전달하고, 연출 완료·스킵 시에는 `player.score`로 자동 복귀한다. `finalScoresRef`에 최종값을 사전 저장해 스킵 핸들러에서 즉시 동기화한다.

### 12. 정산 연출 Flash 방지

페이드 중(`isFading`)에서 완료(`isEliminated`)로 전환할 때 **동일한 animation string**을 유지한다. React는 style prop 변화가 없으면 DOM을 건드리지 않으므로 CSS `animation-fill-mode: forwards`가 해제되지 않고 `opacity: 0` 상태가 동결된다. 이 규칙은 주사위(`dice-sq-exit`)와 지폐(`bill-exit`) 모두에 적용된다.

---

## 환경변수

`.env.local.example`을 복사해 `.env.local`을 만들고 키를 채운다.

```
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
GOOGLE_API_KEY=...

# 플레이어 슬롯별 모델 (선택, 코드 내 기본값 사용 가능)
LLM_PLAYER_1_MODEL=claude-sonnet-4-6
LLM_PLAYER_2_MODEL=gpt-4o
```

---

## 개발 시작

```bash
cp .env.local.example .env.local  # 키 입력 후
npm run dev
```
