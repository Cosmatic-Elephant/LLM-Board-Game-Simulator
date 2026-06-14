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
│   ├── components/              # (미구현) UI 컴포넌트
│   │   ├── Casino.tsx
│   │   ├── PlayerPanel.tsx
│   │   └── DiceRoll.tsx
│   └── app/
│       ├── globals.css
│       ├── layout.tsx
│       ├── page.tsx             # 로비 (플레이어 설정)
│       ├── game/
│       │   └── page.tsx         # 게임 보드
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
