"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import type { CasinoNumber, CasinoState, Color, GameState, PlayerState, ScoringStep } from "@/types/game";
import { getSocket } from "@/lib/socket-client";
import type {
  BetBubblePayload,
  PlayerBubblePayload,
  PlayerLeftPayload,
  RequestGameStateAck,
  ScoringStepsPayload,
  TurnTimerPayload,
} from "@/types/multiplayer";
import { CASINO_NUMBERS } from "@/lib/bill-setup";
import { Casino } from "@/components/Casino";
import { Die } from "@/components/DiceRoll";
import { PlayerPanel } from "@/components/PlayerPanel";

const NOTICE_BUBBLE_DURATION_MS = 3000;
// 카운트다운·점멸 UI를 켜는 기준(남은 초).
const TIMEOUT_WARNING_SECONDS = 5;

// ── 턴 연출 타이밍 상수 (싱글플레이 game/page.tsx와 동일한 값) ──────────────────
const ROLL_DURATION_MS   = 750; // 셔플 애니메이션 총 지속 시간
const ROLL_SHUFFLE_MS    = 50;  // 셔플 중 값이 바뀌는 간격
const DIE_FADE_MS        = 250; // 주사위 등장/퇴장 페이드 지속 시간
const DIE_STAGGER_MS     = 100; // 주사위 순차 등장 간격(개당 지연)
// 봇(깡통/LLM)이 굴린 결과를 화면에 보여준 뒤, 베팅 연출로 넘어가기 전 사람이 결과를 확인할 시간을 준다.
const LLM_PLACE_DELAY_MS = 500;
// 정산 연출 각 단계의 기본 지속 시간(싱글플레이 game/page.tsx와 동일한 값).
const SCORING_FADE_MS = 400;
// 모든 플레이어의 주사위가 소진되어 정산으로 넘어가기 전, 안내 문구를 보여주며 대기하는 시간.
const PRE_SCORING_WAIT_MS = 1500;

// 턴 연출 로컬 상태 — 서버가 보내는 GameState를 즉시 반영하지 않고, 애니메이션이 끝난 뒤에만
// commit()으로 반영한다(그동안 화면은 이전 상태를 계속 보여준다).
type DiceAnim =
  | { kind: "idle" }
  | { kind: "shuffling" }
  | { kind: "bet-exiting"; exitingFace: CasinoNumber };

// 정산 연출 상태 — 싱글플레이 game/page.tsx의 ScoringAnimState와 동일한 구조.
interface ScoringAnimState {
  casinoIdx: number; // 0–5, CASINO_NUMBERS의 인덱스
  fadingColors: Color[]; // 현재 페이드 아웃 중(동률 배제)
  winnerColor: Color | null; // 현재 순위 하이라이트 중인 주사위 행
  highlightedBillIdx: number | null;
  exitingBillIdx: number | null;
  // 카지노 인덱스별 누적 맵 — 다음 카지노로 넘어가도 리셋하지 않는다.
  eliminatedColorsByCasino: Partial<Record<number, Color[]>>;
  exitedBillsByCasino: Partial<Record<number, number[]>>;
  // 마지막 단계: 테이블 전체 정리(잔여 주사위/지폐 동시 페이드 아웃)
  tableClearing: boolean;
}

export default function MultiplayerGamePage() {
  const router = useRouter();

  // 로비에서 방을 만들거나 참가할 때 이미 연결되어 있는 공유 소켓을 그대로 재사용한다.
  // 이 소켓만 서버의 해당 방(room)에 join되어 있으므로, 새 연결을 만들면 브로드캐스트를 받을 수 없다.
  const [connected, setConnected] = useState(() => getSocket().connected);
  const [gameState, setGameState] = useState<GameState | null>(null);
  // 이 소켓이 조작 가능한 플레이어 색상. 게임 시작 시 한 번 정해지면 이후 바뀌지 않는다.
  const [myColor, setMyColor] = useState<Color | null>(null);
  const [isHost, setIsHost] = useState(false);
  // 게임 진행 중 호스트가 이탈하면 방이 닫히므로, 안내 팝업으로 화면 전체를 대체한다.
  const [hostLeft, setHostLeft] = useState(false);
  // 게스트 이탈("{이름}이 이탈했습니다.")과 턴 타임아웃 자동 행동 알림이 함께 재사용하는 말풍선.
  const [noticeBubbles, setNoticeBubbles] = useState<Partial<Record<Color, { message: string; key: number }>>>({});
  const noticeBubbleTimersRef = useRef<Partial<Record<Color, ReturnType<typeof setTimeout>>>>({});
  // 정산 진입 직전(awaiting-action → round-end/game-end) 화면 트리 전체가 다른 return 분기로 교체되면서
  // 말풍선 DOM도 함께 리마운트된다. key는 그대로라 React 재조정만으로는 막을 수 없으므로, 실제로 진입
  // 애니메이션이 "끝난" 말풍선의 key를 색상별로 기억해 두었다가, 같은 key가 다시 마운트되면(=리마운트) 진입
  // 애니메이션을 재생하지 않고 바로 정지 상태로 보여준다. 진짜 새 말풍선(key가 다름)에는 영향 없다.
  const bubbleEnteredKeyRef = useRef<Partial<Record<Color, number>>>({});
  // 현재 사람 플레이어 턴의 타임아웃 마감 시각(서버 기준 epoch ms). null이면 타이머가 걸려 있지 않다(AI 턴 등).
  const [turnDeadline, setTurnDeadline] = useState<number | null>(null);
  // turnDeadline을 기준으로 클라이언트가 매 tick 스스로 계산하는 남은 초. 서버는 deadline만 한 번 알리고,
  // 매초 브로드캐스트하지 않으므로 모든 클라이언트가 같은 deadline에서 동일하게 계산해 자연히 동기화된다.
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  // 카지노 ↔ 주사위 호버 하이라이팅(서로 배타적) — 서버 왕복 없이 클라이언트에서만 처리한다.
  const [hoveredCasino, setHoveredCasino] = useState<number | null>(null);
  const [hoveredDiceFace, setHoveredDiceFace] = useState<number | null>(null);
  // 우측 하단 나가기 버튼의 확인 팝업 노출 여부.
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  // 라운드 종료 화면에서 "게임 종료"를 눌러 로컬로 우승 화면을 띄운 상태인지 여부. 서버 phase는 여전히
  // round-end로 남아있으므로(다른 클라이언트는 계속 라운드 종료 화면을 본다), 이 클라이언트에서만
  // game-end 화면을 대신 렌더링하기 위한 클라이언트 전용 플래그다.
  const [manualGameEnd, setManualGameEnd] = useState(false);

  // ── 턴 연출 상태 ────────────────────────────────────────────────────────────
  // gameState(렌더용)는 애니메이션이 진행되는 동안 "이전" 상태를 그대로 유지한다.
  // 서버가 보낸 상태들은 큐에 순서대로 쌓이고, commit()을 통해 하나씩 gameState로 옮겨진다.
  const [diceAnim, setDiceAnim] = useState<DiceAnim>({ kind: "idle" });
  const [shuffleValues, setShuffleValues] = useState<number[]>([]);
  const [preRollKey, setPreRollKey] = useState(0);
  const committedStateRef = useRef<GameState | null>(null);
  // 굴리기(750ms 셔플)보다 봇의 베팅 지연(500ms)이 더 짧아, 셔플이 끝나기 전에 다음 game-state가 도착하는
  // 경우가 실제로 자주 발생한다. 이때 최신값으로 덮어써 버리면 굴린 결과나 베팅 퇴장 연출을 건너뛰게 되므로,
  // 도착한 순서 그대로 큐에 쌓아 두고 애니메이션이 끝날 때마다 하나씩 꺼내 처리한다.
  const stateQueueRef = useRef<GameState[]>([]);
  const isAnimatingRef = useRef(false);
  // 같은 "턴 시작"에 대해 페이드 인이 중복 재생되지 않도록 마지막으로 재생한 턴의 서명을 기억한다.
  const lastPreRollSigRef = useRef<string | null>(null);
  const shuffleIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const shuffleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const betExitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rollRevealDelayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 서버는 베팅이 처리되는 즉시 bet-bubble을 브로드캐스트하지만(바로 뒤이어 game-state가 따라온다), 화면은
  // 그 game-state를 애니메이션이 끝날 때까지 지연해서 반영한다(굴리기 셔플 → 결과 확인 대기 → 베팅 퇴장).
  // bet-bubble을 도착 즉시 띄우면 베팅 퇴장 연출보다 말풍선이 먼저 나오므로, 여기 큐에 잠깐 보관해 두었다가
  // 실제로 그 베팅의 퇴장 연출이 "시작되는" 시점(또는 퇴장 연출 없이 라운드가 끝나 즉시 커밋되는 시점)에 꺼내
  // 보여준다. bet-bubble과 그 뒤를 잇는 game-state는 같은 소켓 연결의 emit 순서를 그대로 따르므로 도착 순서가
  // 바뀌지 않아, 단순 FIFO로도 항상 올바른 베팅과 짝지어진다.
  const pendingBetBubblesRef = useRef<{ color: Color; message: string }[]>([]);

  function releaseNextBetBubble() {
    const bubble = pendingBetBubblesRef.current.shift();
    if (bubble) showNoticeBubble(bubble.color, bubble.message);
  }

  // ── 정산 연출 상태 ──────────────────────────────────────────────────────────
  // scoringAnim이 null이 아니면 phase가 이미 round-end/game-end로 커밋돼 있어도 그 화면 대신
  // 카지노 그리드 + 연출을 렌더링한다(아래 return 로직 참고).
  const [scoringAnim, setScoringAnim] = useState<ScoringAnimState | null>(null);
  // 정산 연출이 시작되기 전, PRE_SCORING_WAIT_MS 동안 안내 문구만 보여주며 대기하는 중인지 여부.
  // 이 시점에는 scoringAnim이 아직 null이므로, 별도로 화면 분기를 유지해야 round-end/game-end 최종
  // 화면이 먼저 노출되는 것을 막을 수 있다.
  const [scoringPending, setScoringPending] = useState(false);
  const scoringPendingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 정산 전 카지노 보드(주사위·지폐) 스냅샷 — 서버가 applyScoring 직전 상태를 그대로 보내준다.
  // gameState.casinos는 이미 정산으로 초기화돼 있으므로, 연출 중에는 이 값으로 Casino를 렌더링한다.
  const [scoringCasinos, setScoringCasinos] = useState<Record<CasinoNumber, CasinoState> | null>(null);
  const [displayScores, setDisplayScores] = useState<Partial<Record<Color, number>>>({});
  const [scoreDeltaPopups, setScoreDeltaPopups] = useState<Partial<Record<Color, { amount: number; key: number }>>>({});
  const scoringTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // 스킵 시 즉시 반영할 최종 소지금(연출 시작 시점에 계산해 둔다 — gameState는 이미 이 값으로 커밋돼 있다).
  const finalScoresRef = useRef<Partial<Record<Color, number>>>({});
  // scoring-steps는 항상 그 직후의 round-end/game-end game-state보다 먼저 도착하므로, bet-bubble과
  // 동일하게 큐에 담아 두었다가 processQueue가 해당 전이를 감지하는 시점에 꺼내 쓴다.
  const pendingScoringStepsRef = useRef<ScoringStepsPayload[]>([]);
  // "지금 실제로 정산 연출을 재생 중인가"를 나타낸다(isAnimatingRef는 셔플/베팅 퇴장 등 다른 턴 연출에도
  // true가 되므로 별도로 구분해야 한다). scoring-skipped가 도착했을 때 이 값이 false라면 — 이 클라이언트가
  // 지연 등으로 아직 이전 턴 연출을 따라잡는 중이라 정산 연출을 시작조차 안 한 상태이므로, skipRequestedRef만
  // 표시해 두었다가 실제로 startScoringAnimation이 호출되는 즉시 연출 없이 바로 끝낸다.
  const scoringAnimActiveRef = useRef(false);
  const skipRequestedRef = useRef(false);

  // 정산 연출 — 카지노 1번부터 순서대로: 동률 배제 페이드 아웃 → 순위별 하이라이트 → 지폐 페이드 아웃 +
  // displayScore 증가 → 테이블 클리어. 싱글플레이 runScoringAnimation()과 동일한 타이밍/순서다.
  function startScoringAnimation(prev: GameState, next: GameState, payload: ScoringStepsPayload) {
    for (const t of scoringTimersRef.current) clearTimeout(t);
    scoringTimersRef.current = [];
    setScoreDeltaPopups({});

    const finalScores = Object.fromEntries(next.players.map((p) => [p.color, p.score])) as Partial<Record<Color, number>>;
    finalScoresRef.current = finalScores;
    scoringAnimActiveRef.current = true;
    isAnimatingRef.current = true;

    if (skipRequestedRef.current) {
      // 이 연출이 시작되기 전에 이미 스킵 요청이 도착해 있었다 — 연출을 아예 재생하지 않고 바로 끝낸다.
      skipRequestedRef.current = false;
      finishScoringAnimation();
      return;
    }

    const casinoSteps = payload.steps.filter(
      (s): s is Extract<ScoringStep, { kind: "casino-reveal" }> => s.kind === "casino-reveal"
    );

    const preScores = Object.fromEntries(prev.players.map((p) => [p.color, p.score])) as Partial<Record<Color, number>>;
    setDisplayScores(preScores);
    setScoringCasinos(payload.casinos);

    function schedule(fn: () => void, d: number) {
      const t = setTimeout(fn, d);
      scoringTimersRef.current.push(t);
    }

    let delay = 0;

    for (let ci = 0; ci < casinoSteps.length; ci++) {
      const step = casinoSteps[ci];
      const casinoIdx = ci;

      // 카지노 하이라이트 활성화 — 카지노 간 누적 맵은 유지한다.
      schedule(() => {
        setScoringAnim((prevAnim) => ({
          casinoIdx,
          fadingColors: [],
          winnerColor: null,
          highlightedBillIdx: null,
          exitingBillIdx: null,
          eliminatedColorsByCasino: prevAnim?.eliminatedColorsByCasino ?? {},
          exitedBillsByCasino: prevAnim?.exitedBillsByCasino ?? {},
          tableClearing: false,
        }));
      }, delay);
      delay += 150;

      for (const event of step.events) {
        if (event.kind === "tie-eliminated") {
          const ev = event;
          schedule(() => {
            setScoringAnim((prevAnim) => (prevAnim ? { ...prevAnim, fadingColors: ev.colors } : prevAnim));
          }, delay);
          delay += SCORING_FADE_MS;
          schedule(() => {
            setScoringAnim((prevAnim) => {
              if (!prevAnim) return prevAnim;
              const existing = prevAnim.eliminatedColorsByCasino[prevAnim.casinoIdx] ?? [];
              return {
                ...prevAnim,
                fadingColors: [],
                eliminatedColorsByCasino: {
                  ...prevAnim.eliminatedColorsByCasino,
                  [prevAnim.casinoIdx]: [...existing, ...ev.colors],
                },
              };
            });
          }, delay);
          delay += 100;
        } else {
          const ev = event;
          // 순위 하이라이트(주사위 + 지폐)
          schedule(() => {
            setScoringAnim((prevAnim) =>
              prevAnim ? { ...prevAnim, winnerColor: ev.color, highlightedBillIdx: ev.billIndex, exitingBillIdx: null } : prevAnim
            );
          }, delay);
          delay += SCORING_FADE_MS;
          // 지폐 페이드 아웃 + displayScore 증가 + 소지금 팝업 동시 실행
          schedule(() => {
            setScoringAnim((prevAnim) =>
              prevAnim ? { ...prevAnim, winnerColor: null, exitingBillIdx: ev.billIndex } : prevAnim
            );
            setDisplayScores((prevScores) => ({
              ...prevScores,
              [ev.color]: (prevScores[ev.color] ?? 0) + ev.amount,
            }));
            setScoreDeltaPopups((prevPopups) => ({
              ...prevPopups,
              [ev.color]: { amount: ev.amount, key: (prevPopups[ev.color]?.key ?? 0) + 1 },
            }));
          }, delay);
          delay += SCORING_FADE_MS;
          // 사라진 지폐를 카지노별 누적 맵에 반영
          schedule(() => {
            setScoringAnim((prevAnim) => {
              if (!prevAnim) return prevAnim;
              const existing = prevAnim.exitedBillsByCasino[prevAnim.casinoIdx] ?? [];
              return {
                ...prevAnim,
                highlightedBillIdx: null,
                exitingBillIdx: null,
                exitedBillsByCasino: {
                  ...prevAnim.exitedBillsByCasino,
                  [prevAnim.casinoIdx]: [...existing, ev.billIndex],
                },
              };
            });
          }, delay);
          delay += 100;
        }
      }

      delay += Math.round(SCORING_FADE_MS * 0.5);
    }

    // 전체 카지노 처리 완료 — 테이블 클리어 트리거
    schedule(() => {
      setScoringAnim((prevAnim) => (prevAnim ? { ...prevAnim, tableClearing: true } : prevAnim));
    }, delay);
    delay += SCORING_FADE_MS;

    schedule(() => {
      finishScoringAnimation();
    }, delay);
  }

  // 자연 종료(연출 끝)와 스킵(scoring-skipped 수신) 양쪽에서 공유하는 마무리 처리.
  // gameState는 연출 시작 시점에 이미 최종 값으로 커밋돼 있으므로, 여기서는 연출용 로컬 상태만 정리하고
  // displayScore를 최종 소지금으로 동기화한 뒤 큐 처리를 재개한다.
  function finishScoringAnimation() {
    for (const t of scoringTimersRef.current) clearTimeout(t);
    scoringTimersRef.current = [];
    setScoringAnim(null);
    setScoringCasinos(null);
    setScoreDeltaPopups({});
    setDisplayScores(finalScoresRef.current);
    scoringAnimActiveRef.current = false;
    isAnimatingRef.current = false;
    processQueue();
  }

  // 스킵 버튼(호스트 전용) — 서버에 알리기만 하고 로컬에서 바로 끝내지 않는다. 모든 클라이언트가
  // scoring-skipped를 받은 시점에 함께 끝나야 화면이 어긋나지 않는다.
  function handleSkipScoring() {
    if (!isHost) return;
    getSocket().emit("skip-scoring");
  }

  // 애니메이션 없이(또는 애니메이션 종료 후) 서버 상태를 실제로 화면에 반영한다.
  // phase가 "rolling"으로 바뀐 새 턴이면(라운드·턴·현재 플레이어 조합이 이전과 다르면)
  // 빈 주사위 순차 페이드 인을 재생하도록 preRollKey를 갱신한다.
  function commit(next: GameState) {
    committedStateRef.current = next;
    setGameState(next);

    // manualGameEnd는 라운드 종료 화면에서 "게임 종료"를 눌러 로컬로만 우승 화면을 띄운 상태다.
    // 다시하기/다음 라운드 등으로 실제 게임이 재개되면(phase가 더 이상 round-end/game-end가 아니면)
    // 다음에 다시 라운드 종료 화면을 마주쳤을 때 정상적으로 뜨도록 초기화한다.
    if (next.phase !== "round-end" && next.phase !== "game-end") {
      setManualGameEnd(false);
    }

    if (next.phase === "rolling") {
      const signature = `${next.round}:${next.turn}:${next.currentPlayerIndex}`;
      if (lastPreRollSigRef.current !== signature) {
        lastPreRollSigRef.current = signature;
        setPreRollKey((k) => k + 1);
      }
    }
  }

  // prev(직전에 실제로 화면에 반영된 상태)를 기준으로, 이번에 도착한 next에서 어느 카지노에
  // 베팅이 이루어졌는지 추론한다. prev가 awaiting-action이 아니었거나 굴린 결과가 없으면 베팅이 아니다.
  function detectBetCasino(prev: GameState, next: GameState): CasinoNumber | null {
    if (prev.phase !== "awaiting-action" || !prev.currentRoll) return null;
    const bettor = prev.players[prev.currentPlayerIndex];
    for (const n of CASINO_NUMBERS) {
      const prevCount = prev.casinos[n]?.dice[bettor.color] ?? 0;
      const nextCount = next.casinos[n]?.dice[bettor.color] ?? 0;
      if (nextCount > prevCount) return n;
    }
    return null;
  }

  // 큐에 쌓인 game-state를 순서대로 하나씩 꺼내 반영한다. 이미 애니메이션이 진행 중이면 그 애니메이션이
  // 끝난 뒤(startRollShuffle/startBetExit의 setTimeout 콜백) 다시 호출되어 다음 항목을 처리한다.
  function processQueue() {
    if (isAnimatingRef.current) return;
    const next = stateQueueRef.current.shift();
    if (!next) return;

    const prev = committedStateRef.current;
    if (!prev) {
      commit(next);
      processQueue();
      return;
    }

    // 굴리기 완료: 같은 플레이어가 rolling → awaiting-action으로, 굴린 결과가 새로 채워졌다.
    if (
      prev.phase === "rolling" &&
      next.phase === "awaiting-action" &&
      prev.currentPlayerIndex === next.currentPlayerIndex &&
      next.currentRoll
    ) {
      startRollShuffle(next);
      return;
    }

    if (prev.phase === "awaiting-action") {
      // 베팅 완료: awaiting-action이었던 상태가 다음 플레이어의 rolling으로 넘어갔다 — 퇴장 연출을 재생한다
      // (연출이 "시작"되는 시점에 큐에 쌓아 둔 베팅 말풍선도 함께 내보낸다. startBetExit 참고).
      if (next.phase === "rolling") {
        const casino = detectBetCasino(prev, next);
        if (casino !== null) {
          startBetExit(next, casino);
          return;
        }
        // 정상적으로는 항상 casino를 찾아야 하지만, 혹시 못 찾더라도 큐에 남은 말풍선이 다음 베팅과
        // 뒤섞이지 않도록 여기서 내보낸다.
        releaseNextBetBubble();
      } else if (next.phase === "round-end" || next.phase === "game-end") {
        // 라운드의 마지막 베팅 — 정산으로 casinos가 이미 초기화돼 있어 detectBetCasino로는 어느 카지노인지
        // 알 수 없지만, awaiting-action → round-end/game-end 전이는 항상 베팅 완료로만 일어나므로(퇴장
        // 연출은 재생하지 않고) 큐에 쌓인 말풍선을 그대로 내보낸다.
        releaseNextBetBubble();

        const scoringPayload = pendingScoringStepsRef.current.shift();
        if (scoringPayload) {
          // 실제 상태(점수·billDeck 등)는 원칙대로 즉시 반영하고, 정산 연출만 별도로 재생한다.
          commit(next);
          // 정산 연출 시작 전 PRE_SCORING_WAIT_MS만큼 안내 문구를 보여주며 대기한다. 이 기간에는
          // 아직 정산 전 카지노 스냅샷만 미리 보여주고(하이라이트 없음), 대기가 끝나면 남은 말풍선을
          // 모두 정리한 뒤 실제 정산 연출을 시작한다.
          isAnimatingRef.current = true;
          setScoringCasinos(scoringPayload.casinos);
          setScoringPending(true);
          scoringPendingTimeoutRef.current = setTimeout(() => {
            scoringPendingTimeoutRef.current = null;
            setScoringPending(false);
            clearAllNoticeBubbles();
            startScoringAnimation(prev, next, scoringPayload);
          }, PRE_SCORING_WAIT_MS);
          return;
        }
      }
    }

    commit(next);
    processQueue();
  }

  // 주사위 셔플 애니메이션 — ROLL_DURATION_MS 동안 무작위 눈을 빠르게 보여주다가, 끝나면 실제 결과(next)를 커밋한다.
  function startRollShuffle(next: GameState) {
    const diceCount = next.currentRoll?.length ?? 0;
    if (diceCount === 0) { commit(next); processQueue(); return; }

    isAnimatingRef.current = true;
    setDiceAnim({ kind: "shuffling" });

    const randomFaces = () => Array.from({ length: diceCount }, () => Math.floor(Math.random() * 6) + 1);
    setShuffleValues(randomFaces());
    shuffleIntervalRef.current = setInterval(() => setShuffleValues(randomFaces()), ROLL_SHUFFLE_MS);

    shuffleTimeoutRef.current = setTimeout(() => {
      if (shuffleIntervalRef.current) { clearInterval(shuffleIntervalRef.current); shuffleIntervalRef.current = null; }
      setDiceAnim({ kind: "idle" });
      commit(next);

      // 굴린 사람이 봇(깡통/LLM)이면, 서버 베팅 이벤트가 이미 큐에 도착해 있더라도 곧바로 베팅 퇴장
      // 연출로 넘어가지 않고 싱글플레이와 동일하게 LLM_PLACE_DELAY_MS만큼 결과를 보여준 뒤 큐를 이어 처리한다.
      // isAnimatingRef를 계속 true로 유지해, 이 지연 동안 도착하는 새 상태도 큐에만 쌓이고 처리되지 않게 한다.
      const roller = next.players[next.currentPlayerIndex];
      if (roller.isLLM) {
        rollRevealDelayTimeoutRef.current = setTimeout(() => {
          isAnimatingRef.current = false;
          processQueue();
        }, LLM_PLACE_DELAY_MS);
      } else {
        isAnimatingRef.current = false;
        processQueue();
      }
    }, ROLL_DURATION_MS);
  }

  // 베팅 퇴장 애니메이션 — DIE_FADE_MS 동안 해당 눈의 주사위를 위로 페이드 아웃시킨 뒤 next를 커밋한다.
  // 싱글플레이(handleCasinoSelect)와 동일하게, 연출이 시작되는 이 시점에 베팅 말풍선도 함께 노출한다.
  function startBetExit(next: GameState, exitingFace: CasinoNumber) {
    isAnimatingRef.current = true;
    setDiceAnim({ kind: "bet-exiting", exitingFace });
    releaseNextBetBubble();

    betExitTimeoutRef.current = setTimeout(() => {
      setDiceAnim({ kind: "idle" });
      commit(next);
      isAnimatingRef.current = false;
      processQueue();
    }, DIE_FADE_MS);
  }

  // 서버에서 game-state가 도착할 때마다 큐에 넣고, 현재 애니메이션이 없으면 바로 처리한다.
  function handleIncomingGameState(next: GameState) {
    stateQueueRef.current.push(next);
    processQueue();
  }

  // 싱글플레이(game/page.tsx)와 동일한 말풍선 문구 형식: LLM은 근거를 이어붙이고, 타임아웃은 안내 문구를 덧붙인다.
  function buildBetBubbleMessage({ casinoNumber, reasoning, isTimeout }: BetBubblePayload): string {
    let message = `${casinoNumber}번 카지노에 베팅했어요.`;
    if (reasoning) message += ` ${reasoning}`;
    if (isTimeout) message += `\n시간 초과로 자동 행동했습니다.`;
    return message;
  }

  function showNoticeBubble(color: Color, message: string) {
    const existing = noticeBubbleTimersRef.current[color];
    if (existing) clearTimeout(existing);
    setNoticeBubbles((prev) => ({
      ...prev,
      [color]: { message, key: (prev[color]?.key ?? 0) + 1 },
    }));
    noticeBubbleTimersRef.current[color] = setTimeout(() => {
      setNoticeBubbles((prev) => {
        const next = { ...prev };
        delete next[color];
        return next;
      });
      delete noticeBubbleTimersRef.current[color];
    }, NOTICE_BUBBLE_DURATION_MS);
  }

  // 정산 연출 진입 직전, 남아있는 말풍선을 hover 등 상태와 무관하게 전부 제거한다.
  function clearAllNoticeBubbles() {
    for (const t of Object.values(noticeBubbleTimersRef.current)) { if (t) clearTimeout(t); }
    noticeBubbleTimersRef.current = {};
    setNoticeBubbles({});
  }

  useEffect(() => {
    const socket = getSocket();

    function handleConnect() { setConnected(true); }
    function handleDisconnect() { setConnected(false); }
    function handleGameState(state: GameState) { handleIncomingGameState(state); }
    function handleHostLeft() { setHostLeft(true); }
    function handleGameEnded() { router.push("/"); }
    function handlePlayerLeft({ color, name }: PlayerLeftPayload) {
      showNoticeBubble(color, `${name}이 이탈했습니다.`);
    }
    function handlePlayerBubble({ color, message }: PlayerBubblePayload) {
      showNoticeBubble(color, message);
    }
    function handleBetBubble(payload: BetBubblePayload) {
      // 즉시 띄우지 않고 큐에 보관한다 — 실제 표시 시점은 해당 베팅의 퇴장 연출이 시작될 때다
      // (releaseNextBetBubble 호출부 참고). 그렇지 않으면 서버가 베팅을 처리하자마자(연출 대기 전에)
      // 말풍선이 먼저 떠 버린다.
      pendingBetBubblesRef.current.push({ color: payload.color, message: buildBetBubbleMessage(payload) });
    }
    function handleTurnTimer({ deadline }: TurnTimerPayload) {
      setTurnDeadline(deadline);
    }
    function handleScoringSteps(payload: ScoringStepsPayload) {
      // 즉시 사용하지 않고 큐에 보관한다 — processQueue가 round-end/game-end 전이를 감지하는
      // 시점에 꺼내 startScoringAnimation()에 넘긴다(bet-bubble과 동일한 페어링 패턴).
      pendingScoringStepsRef.current.push(payload);
    }
    function handleScoringSkipped() {
      if (scoringAnimActiveRef.current) {
        finishScoringAnimation();
      } else {
        // 이 클라이언트가 아직 정산 연출을 시작하지 않았다(다른 턴 연출을 따라잡는 중일 수 있다) —
        // 실제로 시작되는 즉시 연출 없이 바로 끝내도록 표시만 해 둔다.
        skipRequestedRef.current = true;
      }
    }

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("game-state", handleGameState);
    socket.on("host-left", handleHostLeft);
    socket.on("game-ended", handleGameEnded);
    socket.on("player-left", handlePlayerLeft);
    socket.on("player-bubble", handlePlayerBubble);
    socket.on("bet-bubble", handleBetBubble);
    socket.on("turn-timer", handleTurnTimer);
    socket.on("scoring-steps", handleScoringSteps);
    socket.on("scoring-skipped", handleScoringSkipped);

    // game-started/game-state 브로드캐스트는 호스트가 게임을 시작하는 즉시 나가므로, 이 페이지가
    // 아직 마운트되기 전(이동 중)이라 놓쳤을 수 있다. 마운트 시 현재 상태를 다시 요청해 보정한다.
    socket.emit("request-game-state", (res: RequestGameStateAck) => {
      if (res.gameState) handleIncomingGameState(res.gameState);
      setMyColor(res.myColor);
      setIsHost(res.isHost);
      setTurnDeadline(res.turnDeadline);
    });

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("game-state", handleGameState);
      socket.off("host-left", handleHostLeft);
      socket.off("game-ended", handleGameEnded);
      socket.off("player-left", handlePlayerLeft);
      socket.off("player-bubble", handlePlayerBubble);
      socket.off("bet-bubble", handleBetBubble);
      socket.off("turn-timer", handleTurnTimer);
      socket.off("scoring-steps", handleScoringSteps);
      socket.off("scoring-skipped", handleScoringSkipped);
      for (const t of Object.values(noticeBubbleTimersRef.current)) { if (t) clearTimeout(t); }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // 언마운트 시 진행 중이던 턴/정산 연출 타이머를 정리한다.
  useEffect(() => {
    return () => {
      if (shuffleIntervalRef.current) clearInterval(shuffleIntervalRef.current);
      if (shuffleTimeoutRef.current) clearTimeout(shuffleTimeoutRef.current);
      if (betExitTimeoutRef.current) clearTimeout(betExitTimeoutRef.current);
      if (rollRevealDelayTimeoutRef.current) clearTimeout(rollRevealDelayTimeoutRef.current);
      if (scoringPendingTimeoutRef.current) clearTimeout(scoringPendingTimeoutRef.current);
      for (const t of scoringTimersRef.current) clearTimeout(t);
    };
  }, []);

  // turnDeadline이 바뀔 때마다 로컬에서 남은 초를 다시 계산해 카운트다운을 재시작한다.
  useEffect(() => {
    if (turnDeadline === null) {
      setRemainingSeconds(null);
      return;
    }
    function tick() {
      setRemainingSeconds(Math.max(0, Math.ceil((turnDeadline! - Date.now()) / 1000)));
    }
    tick();
    const interval = setInterval(tick, 200);
    return () => clearInterval(interval);
  }, [turnDeadline]);

  // 카지노 ↔ 주사위 호버 하이라이팅은 본인 턴 + 굴린 후(awaiting-action) + 연출 중이 아닐 때만 켠다.
  // gameState가 아직 없을 수도 있으므로(마운트 초기) optional chaining으로 안전하게 계산한다.
  const hoverCurrentPlayer = gameState?.players[gameState.currentPlayerIndex];
  const hoverEnabled =
    !!gameState &&
    gameState.phase === "awaiting-action" &&
    diceAnim.kind === "idle" &&
    myColor !== null &&
    hoverCurrentPlayer?.color === myColor;

  // 턴이 넘어가거나(hoverEnabled가 false로 바뀌면) 마우스를 움직이지 않아도 이전 호버 상태가 남지 않게 정리한다.
  useEffect(() => {
    if (!hoverEnabled) {
      setHoveredCasino(null);
      setHoveredDiceFace(null);
    }
  }, [hoverEnabled]);

  // 두 하이라이팅은 서로 배타적이다 — 하나를 켜면 다른 쪽은 끈다. mouseleave(n=null)는 hoverEnabled와
  // 무관하게 항상 허용해, 턴이 바뀌는 순간에도 이미 떠 있던 하이라이트가 확실히 지워지게 한다.
  function handleCasinoHover(n: number | null) {
    if (n !== null && !hoverEnabled) return;
    setHoveredCasino(n);
    setHoveredDiceFace(null);
  }

  function handleDiceHover(face: number | null) {
    if (face !== null && !hoverEnabled) return;
    setHoveredDiceFace(face);
    setHoveredCasino(null);
  }

  function handleRollDice() {
    if (diceAnim.kind !== "idle") return;
    getSocket().emit("roll-dice");
  }

  function handlePlaceBet(casino: CasinoNumber) {
    if (diceAnim.kind !== "idle") return;
    getSocket().emit("place-bet", { casino });
  }

  function handleNextRound() {
    if (!isHost) return;
    getSocket().emit("next-round");
  }

  // 라운드 종료 화면의 "게임 종료" — 서버에 알리지 않고 이 클라이언트만 로컬로 우승 화면을 띄운다.
  // 다른 클라이언트는 계속 라운드 종료 화면(다음 라운드/게임 종료 버튼)을 본다.
  function handleShowGameEnd() {
    setManualGameEnd(true);
  }

  // 우승 화면의 "다시하기"(호스트 전용) — 서버가 동일한 플레이어 구성으로 게임을 재초기화하고
  // 방 전체에 game-state를 브로드캐스트한다. 응답을 받으면 commit()이 manualGameEnd를 자동으로 해제한다.
  function handleRestartGame() {
    if (!isHost) return;
    getSocket().emit("restart-game");
  }

  // 나가기 확인 팝업의 "예" 및 우승 화면의 "나가기" — 기존 이탈 처리 로직(server.ts의
  // removeParticipant/handleParticipantLeaveDuringGame)을 그대로 재사용한다. 호스트는 end-game(게임 종료 +
  // 전원 퇴장), 게스트는 leave-room(본인 슬롯만 깡통 대체)을 보낸다.
  function handleExitConfirm() {
    if (isHost) {
      getSocket().emit("end-game");
      return;
    }
    getSocket().emit("leave-room");
    router.push("/");
  }

  // 플레이어 패널 위에 "생각 중.../카운트다운"(또는 정산 중 소지금 증가 팝업)과 이탈·타임아웃 말풍선을
  // 조건부로 얹어 렌더링한다. displayScore는 정산 연출 중에만 넘겨 실제 값 대신 보여준다.
  function renderPlayerPanel(player: PlayerState, label: string, isActive: boolean, displayScore?: number) {
    const bubble = noticeBubbles[player.color];
    const popup = scoringAnim !== null ? scoreDeltaPopups[player.color] : undefined;
    const showCountdown =
      isActive && remainingSeconds !== null && remainingSeconds >= 1 && remainingSeconds <= TIMEOUT_WARNING_SECONDS;

    return (
      <div key={player.color} className="flex flex-col items-center gap-1">
        {popup ? (
          <p
            key={popup.key}
            className="text-xl font-bold text-yellow-300"
            style={{ animation: "score-popup 1200ms ease-out forwards" }}
          >
            +{popup.amount.toLocaleString()}
          </p>
        ) : (
          <p className={`text-sm font-bold text-yellow-400 animate-pulse -translate-y-1 ${isActive ? "" : "invisible"}`}>
            {showCountdown ? remainingSeconds : "생각 중..."}
          </p>
        )}
        <div className="relative">
          {bubble && (
            <div
              key={bubble.key}
              className="absolute bottom-full mb-3 w-[150px] z-10"
              style={
                bubbleEnteredKeyRef.current[player.color] === bubble.key
                  ? undefined
                  : { animation: "bubble-in 200ms ease-out forwards" }
              }
              onAnimationEnd={() => {
                bubbleEnteredKeyRef.current[player.color] = bubble.key;
              }}
            >
              <div className="relative bg-zinc-700 border border-zinc-500 rounded-xl px-3 py-2 shadow-lg">
                <p className="text-xs text-gray-200 leading-relaxed break-words whitespace-pre-line">
                  {bubble.message}
                </p>
                <div style={{ position: "absolute", bottom: -8, left: "50%", transform: "translateX(-50%)", width: 0, height: 0, borderLeft: "8px solid transparent", borderRight: "8px solid transparent", borderTop: "8px solid #71717a" }} />
                <div style={{ position: "absolute", bottom: -7, left: "50%", transform: "translateX(-50%)", width: 0, height: 0, borderLeft: "7px solid transparent", borderRight: "7px solid transparent", borderTop: "7px solid #3f3f46" }} />
              </div>
            </div>
          )}
          <PlayerPanel player={player} label={label} isActive={isActive} displayScore={displayScore} />
        </div>
      </div>
    );
  }

  // 우측 하단 고정 나가기 버튼 + 확인 팝업. 싱글플레이는 항상 같은 <main> 안에서 조건부로 내용만 바뀌지만,
  // 멀티는 phase별로 return을 분리해 두었으므로 모든 화면(진행 중/라운드 종료/게임 종료)에서 재사용한다.
  function renderExitControls() {
    return (
      <>
        <button
          className="fixed right-4 bottom-28 w-12 h-12 rounded-full bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-900 border border-zinc-600 flex items-center justify-center transition-colors shadow-lg"
          onClick={() => setShowExitConfirm(true)}
          aria-label="나가기"
        >
          <Image src="/img/exit.png" alt="나가기" width={24} height={24} />
        </button>

        {showExitConfirm && (
          <div
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
            onClick={() => setShowExitConfirm(false)}
          >
            <div
              className="bg-zinc-800 border border-zinc-600 rounded-2xl px-8 py-6 flex flex-col items-center gap-5 shadow-xl max-w-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="text-sm font-semibold text-white text-center">
                {isHost
                  ? "방을 나가면 게임이 종료되고 모든 플레이어가 퇴장됩니다."
                  : "방을 나가면 해당 자리는 깡통으로 대체됩니다."}
              </span>
              <div className="flex gap-3">
                <button
                  className="px-6 py-2.5 bg-blue-700 hover:bg-blue-600 active:bg-blue-800 rounded-xl text-sm font-bold transition-colors"
                  onClick={handleExitConfirm}
                >
                  예
                </button>
                <button
                  className="px-6 py-2.5 bg-gray-700 hover:bg-gray-600 active:bg-gray-800 rounded-xl text-sm font-bold transition-colors"
                  onClick={() => setShowExitConfirm(false)}
                >
                  아니오
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // 호스트가 이탈해 방이 닫힌 경우, 어느 phase였는지와 무관하게 안내 팝업으로 화면 전체를 대체한다.
  if (hostLeft) {
    return (
      <main className="h-screen bg-zinc-950 text-white flex items-center justify-center">
        <div className="bg-zinc-800 border border-zinc-600 rounded-2xl p-6 flex flex-col items-center gap-5 shadow-xl w-[420px]">
          <span className="text-sm text-gray-300">호스트가 방을 이탈했습니다.</span>
          <button
            onClick={() => router.push("/")}
            className="px-6 py-2.5 bg-yellow-500 hover:bg-yellow-400 active:bg-yellow-600 rounded-xl text-sm font-bold text-black transition-colors"
          >
            확인
          </button>
        </div>
      </main>
    );
  }

  // 서버에서 게임 상태를 수신하기 전까지는 대기 화면만 렌더링한다.
  if (!gameState) {
    return (
      <main className="h-screen bg-zinc-950 text-white flex items-center justify-center">
        <span className="text-sm text-gray-400">
          {connected ? "게임 상태를 기다리는 중입니다..." : "서버에 연결하는 중입니다..."}
        </span>
      </main>
    );
  }

  const { casinos, players, round, billDeck, currentPlayerIndex, phase, currentRoll } = gameState;

  // ── 정산 연출: gameState.phase는 이미 round-end/game-end로 커밋돼 있어도(실제 데이터는 즉시 반영
  // 원칙), scoringAnim이 남아있거나(연출 재생 중) scoringPending이 켜져 있는(연출 시작 전 대기) 동안은
  // 그 화면 대신 카지노 그리드 + 연출을 그대로 보여준다.
  if (scoringAnim !== null || scoringPending) {
    const anim = scoringAnim;
    return (
      // key="scoring" — 게임 진행 화면과 구조가 부분적으로 겹쳐(같은 태그가 같은 위치에 오는 경우 등)
      // React가 엉뚱한 자식(예: 이전에 활성 표시로 위로 이동해 있던 플레이어 패널)을 그대로 재사용하는
      // 것을 막는다. 화면 종류가 바뀔 때마다 항상 완전히 새로 마운트시켜, 정산 시작 시점에 모든 패널이
      // 기본 위치(isActive=false)로 확실히 리셋되도록 한다.
      <main key="scoring" className="h-screen bg-zinc-950 text-white flex flex-col p-4 gap-5 overflow-hidden">
        <section className="grid grid-cols-6 gap-3">
          {CASINO_NUMBERS.map((n, idx) => {
            const isCurrentCasino = anim !== null && anim.casinoIdx === idx && !anim.tableClearing;
            return (
              <Casino
                key={n}
                number={n}
                state={scoringCasinos![n]}
                canPlace={true}
                selectable={false}
                highlighted={isCurrentCasino}
                scoringFadingColors={isCurrentCasino ? anim!.fadingColors : undefined}
                scoringEliminatedColors={anim?.eliminatedColorsByCasino[idx]}
                scoringHighlightedColor={isCurrentCasino ? anim!.winnerColor : undefined}
                scoringHighlightedBillIdx={isCurrentCasino ? anim!.highlightedBillIdx : undefined}
                scoringExitingBillIdx={isCurrentCasino ? anim!.exitingBillIdx : undefined}
                scoringExitedBillIndices={anim?.exitedBillsByCasino[idx]}
                scoringTableClearing={anim?.tableClearing ?? false}
                fadeDuration={SCORING_FADE_MS}
                onHover={() => {}}
              />
            );
          })}
        </section>

        <section className="flex-1 flex flex-col justify-center items-center gap-3">
          {scoringPending ? (
            <span className="text-lg font-bold text-yellow-300 select-none">
              라운드 종료 / 정산을 시작합니다.
            </span>
          ) : (
            <>
              <span className="text-sm text-gray-400 select-none">정산 중</span>
              {isHost && (
                <button
                  className="px-5 py-2.5 bg-gray-700/60 hover:bg-gray-600/60 active:bg-gray-800/60 rounded-xl text-sm font-bold text-gray-400 hover:text-gray-200 transition-colors"
                  onClick={handleSkipScoring}
                >
                  스킵
                </button>
              )}
            </>
          )}
        </section>

        <section className="flex gap-4 justify-center">
          {players.map((player, i) =>
            renderPlayerPanel(player, player.name ?? `플레이어 ${i + 1}`, false, displayScores[player.color])
          )}
        </section>

        {renderExitControls()}
      </main>
    );
  }

  // ── 라운드 종료: 정산 결과(소지금) 표시 + 다음 라운드(호스트 전용)/게임 종료 버튼 ──
  if (phase === "round-end" && !manualGameEnd) {
    return (
      <main key="round-end" className="h-screen bg-zinc-950 text-white flex flex-col items-center justify-center gap-6">
        <span className="text-2xl font-bold text-yellow-400">라운드 종료</span>
        <section className="flex gap-4 justify-center">
          {players.map((player, i) => renderPlayerPanel(player, player.name ?? `플레이어 ${i + 1}`, false))}
        </section>
        <div className="flex gap-3">
          <button
            className={[
              "px-6 py-3 bg-blue-700 rounded-xl font-bold text-sm transition-colors",
              isHost ? "hover:bg-blue-600 active:bg-blue-800" : "opacity-40 cursor-not-allowed",
            ].join(" ")}
            disabled={!isHost}
            onClick={handleNextRound}
          >
            다음 라운드
          </button>
          <button
            className="px-6 py-3 bg-gray-700 hover:bg-gray-600 active:bg-gray-800 rounded-xl font-bold text-sm transition-colors"
            onClick={handleShowGameEnd}
          >
            게임 종료
          </button>
        </div>
        {renderExitControls()}
      </main>
    );
  }

  // ── 게임 종료: 최종 소지금과 우승자 표시 (지폐 소진으로 자연 종료됐거나, 라운드 종료 화면에서
  // "게임 종료"를 눌러 이 클라이언트만 로컬로 진입한 경우 둘 다 이 화면을 보여준다) ──
  if (phase === "game-end" || manualGameEnd) {
    const maxScore = Math.max(...players.map((p) => p.score));
    const winnerNames = players
      .filter((p) => p.score === maxScore)
      .map((p) => p.name ?? p.color)
      .join(", ");

    return (
      <main key="game-end" className="h-screen bg-zinc-950 text-white flex flex-col items-center justify-center gap-6">
        <span className="text-xl font-bold text-yellow-300">
          {winnerNames}가 {maxScore.toLocaleString()}원으로 우승!
        </span>
        <section className="flex gap-4 justify-center">
          {players.map((player, i) => renderPlayerPanel(player, player.name ?? `플레이어 ${i + 1}`, false))}
        </section>
        <div className="flex gap-3">
          <button
            className="px-6 py-3 bg-gray-700 hover:bg-gray-600 active:bg-gray-800 rounded-xl font-bold text-sm transition-colors"
            onClick={handleExitConfirm}
          >
            나가기
          </button>
          <button
            className={[
              "px-6 py-3 bg-blue-700 rounded-xl font-bold text-sm transition-colors",
              isHost ? "hover:bg-blue-600 active:bg-blue-800" : "opacity-40 cursor-not-allowed",
            ].join(" ")}
            disabled={!isHost}
            onClick={handleRestartGame}
          >
            다시하기
          </button>
        </div>
        {renderExitControls()}
      </main>
    );
  }

  const current = players[currentPlayerIndex];
  const isMyTurn = myColor !== null && current.color === myColor;
  const rollFaces = new Set(currentRoll ?? []);

  // 싱글플레이(game/page.tsx)와 동일한 그룹화 로직: 오름차순 정렬 후 같은 눈끼리 묶어, 그룹 사이에는
  // 더 큰 간격을 준다. 서버의 rollDice()는 순서를 정렬하지 않으므로 여기서 표시용으로만 정렬한다.
  const sortedRoll = [...(currentRoll ?? [])].sort((a, b) => a - b);
  const diceGroups = sortedRoll.reduce<number[][]>((groups, face) => {
    const last = groups[groups.length - 1];
    if (last && last[0] === face) { last.push(face); } else { groups.push([face]); }
    return groups;
  }, []);

  // 본인 턴이고 남은 시간이 5초 이하일 때만 켠다 — 굴리기 버튼/카지노 테두리 점멸은 본인 클라이언트에만 표시된다.
  const timeoutWarningActive =
    isMyTurn && remainingSeconds !== null && remainingSeconds >= 1 && remainingSeconds <= TIMEOUT_WARNING_SECONDS;

  // pre-roll: 전부 밝게(아직 선택 불가) / awaiting-action: 굴린 눈에 해당하는 카지노만 밝게 + 내 턴일 때만 클릭 가능
  function casinoCanPlace(n: CasinoNumber): boolean {
    return phase === "rolling" || rollFaces.has(n);
  }

  function casinoSelectable(n: CasinoNumber): boolean {
    // 셔플·베팅 퇴장 애니메이션 중에는 서버 상태가 이미 다음 단계로 넘어갔어도 화면은 아직 이전 턴을
    // 보여주고 있으므로(committed 지연), 이 기간 동안의 클릭은 막는다.
    if (diceAnim.kind !== "idle") return false;
    return isMyTurn && phase === "awaiting-action" && rollFaces.has(n);
  }

  // TODO: 정산 연출 애니메이션은 추후 구현. 지금은 굴리기·베팅·라운드 전환까지만 상호작용한다.
  return (
    <main key="play" className="h-screen bg-zinc-950 text-white flex flex-col p-4 gap-5 overflow-hidden">
      {/* ── Casinos ─────────────────────────────────────────────────────── */}
      <section className="grid grid-cols-6 gap-3">
        {CASINO_NUMBERS.map((n) => (
          <Casino
            key={n}
            number={n}
            state={casinos[n]}
            canPlace={casinoCanPlace(n)}
            selectable={casinoSelectable(n)}
            highlighted={hoverEnabled && hoveredDiceFace === n}
            // 점멸 우선순위: 주사위 호버로 이 카지노가 하이라이팅 중이면 타임아웃 점멸을 잠시 끈다.
            timeoutWarning={
              phase === "awaiting-action" &&
              timeoutWarningActive &&
              casinoSelectable(n) &&
              !(hoverEnabled && hoveredDiceFace === n)
            }
            onHover={handleCasinoHover}
            onSelect={() => handlePlaceBet(n)}
          />
        ))}
      </section>

      {/* ── Middle: dice ────────────────────────────────────────────────── */}
      <section className="flex-1 flex flex-col justify-center items-center gap-3">
        {diceAnim.kind === "shuffling" ? (
          // 굴리기 셔플 애니메이션 — 결과가 확정될 때까지 무작위 눈을 빠르게 보여준다.
          <div className="flex items-center gap-2">
            {shuffleValues.map((face, idx) => (
              <Die key={idx} value={face} playerColor={current.color} />
            ))}
          </div>
        ) : phase === "rolling" ? (
          <>
            {/* 턴 시작 — 빈 주사위 순차 페이드 인 (preRollKey로 매 턴 애니메이션 재시작) */}
            <div className="flex items-center gap-2">
              {Array.from({ length: current.diceRemaining }, (_, idx) => (
                <Die
                  key={`die-${preRollKey}-${idx}`}
                  value={0}
                  playerColor={current.color}
                  fadeInDelay={idx * DIE_STAGGER_MS}
                  fadeDuration={DIE_FADE_MS}
                />
              ))}
            </div>
            <button
              className={[
                "px-6 py-3 bg-gray-600 hover:bg-gray-500 active:bg-gray-700",
                "rounded-xl font-bold text-sm transition-colors border-2 border-transparent",
                isMyTurn ? "" : "invisible pointer-events-none",
              ].join(" ")}
              style={timeoutWarningActive ? { animation: "timeout-blink 500ms ease-in-out infinite" } : undefined}
              onClick={handleRollDice}
            >
              굴리기
            </button>
          </>
        ) : (
          // 굴린 결과 — 같은 눈끼리는 좁은 간격(gap-2), 다른 눈 그룹 사이는 넓은 간격(gap-4)으로 묶어 표시한다.
          <div className="flex items-center gap-4">
            {diceGroups.map((group, gi) => (
              <div key={gi} className="flex items-center gap-2">
                {group.map((face, i) => (
                  <Die
                    key={`${gi}-${i}`}
                    value={face}
                    playerColor={current.color}
                    highlighted={hoverEnabled && face !== 0 && hoveredCasino === face}
                    onHover={handleDiceHover}
                    exiting={diceAnim.kind === "bet-exiting" && face === diceAnim.exitingFace}
                    fadeDuration={DIE_FADE_MS}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Round info ──────────────────────────────────────────────────── */}
      <div className="flex justify-center">
        <span className="text-sm text-gray-400 select-none">
          {round}라운드 | 남은 지폐 {billDeck.length}장
        </span>
      </div>

      {/* ── Player panels ───────────────────────────────────────────────── */}
      <section className="flex gap-4 justify-center">
        {players.map((player, i) => renderPlayerPanel(player, player.name ?? `플레이어 ${i + 1}`, i === currentPlayerIndex))}
      </section>

      {renderExitControls()}
    </main>
  );
}
