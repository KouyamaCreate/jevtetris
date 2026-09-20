"use client";

import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Moon,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Sun,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  addPendingGarbage,
  applyArenaAction,
  createArenaState,
  emptyBoard,
  findPosePath,
  getBattlePlacements,
  getDropY,
  getGravityIntervalMs,
  getJevOpponentSnapshot,
  getJevDecisionContext,
  getLegalPlacements,
  getPieceMatrix,
  tickArena,
  type ArenaAction,
  type ArenaState,
  type ArenaStep,
  type ClearTechnique,
  type PieceType,
  type TetrisStrategy,
} from "@/lib/tetris";

const STRATEGY_TEXT: Record<TetrisStrategy, string> = {
  safe: "Stay alive. Avoid holes and tall stacks. Keep the surface smooth and clear lines when safe.",
  aggressive: "Clear as many lines as possible. Prefer four-line clears when safe; keep a well open if possible.",
  chaos: "Choose unusual placements and rotations. Keep the game alive and avoid topping out.",
};
const STRATEGY_OPTIONS: { id: TetrisStrategy; label: string }[] = [
  { id: "safe", label: "safe" },
  { id: "aggressive", label: "aggressive" },
  { id: "chaos", label: "chaos" },
];
// A Jev probability is not a physical landing guarantee.  Use it to decide
// whether the model's strategic target is trusted; once a target has been
// accepted (or a local rescue has been selected), the exact pose/landing
// checks below decide whether a hard drop is legal.
const JEV_CONFIDENCE_THRESHOLD = 0.7;
const JEV_ACTION_INTERVAL_MS = 32;
const JEV_REQUEST_TIMEOUT_MS = 8_000;

type MatchPhase = "ready" | "playing" | "paused" | "error" | "finished";
type JevStatus = "idle" | "thinking" | "guiding" | "late" | "fallback" | "error";
type Winner = "you" | "jev" | "draw" | null;
type JevTargetOrigin = "jev" | "fallback";
type JevTarget = {
  pieceId: number;
  piece: PieceType;
  x: number;
  y: number;
  rotation: number;
  lastActionWasRotation: boolean;
  useHold: boolean;
  confidence: number | null;
  linesCleared: number;
  technique: ClearTechnique;
  tSpin: "none" | "mini" | "full";
  outgoingAttack: number;
  garbageCancelled: number;
  origin: JevTargetOrigin;
  originReason: string | null;
} | null;

type BattleEvent = {
  id: number;
  target: "player" | "jev";
  lines: number;
  clearType: ClearTechnique;
};

type EvaluationInfo = {
  status: JevStatus;
  provider: string | null;
  probability: number | null;
  elapsedMs: number | null;
  inputTokens: number | null;
  posture: string | null;
  risk: string | null;
  error: string | null;
  actionUrl?: string;
};

type MatchState = {
  phase: MatchPhase;
  player: ArenaState;
  jev: ArenaState;
  jevTarget: JevTarget;
  evaluation: EvaluationInfo;
  winner: Winner;
  battleEvent: BattleEvent | null;
};

type MoveApiResponse = {
  provider?: string;
  move?: {
    id?: string;
    x?: number;
    y?: number;
    rotation?: number;
    source?: "play" | "hold";
    lastActionWasRotation?: boolean;
  };
  probability?: number;
  posture?: string;
  risk?: string;
  elapsedMs?: number;
  usage?: { inputTokens?: number };
  error?: string;
  actionUrl?: string;
};

function idleArena(): ArenaState {
  return {
    board: emptyBoard(),
    active: null,
    queue: ["T", "I", "O", "S", "Z", "J", "L", "I", "T", "O", "S", "Z", "J"],
    hold: null,
    canHold: true,
    score: 0,
    lines: 0,
    level: 1,
    pieces: 0,
    combo: 0,
    backToBack: false,
    pendingGarbage: 0,
    gravityElapsedMs: 0,
    lockElapsedMs: 0,
    lockResets: 0,
    visual: null,
    gameOver: false,
    gameOverReason: null,
    lastLinesCleared: 0,
    lastAttack: 0,
    lastAttackPower: 0,
    lastGarbageCancelled: 0,
    lastClearType: "none",
    lastTSpin: "none",
  };
}

function createReadyMatch(): MatchState {
  return {
    phase: "ready",
    player: idleArena(),
    jev: idleArena(),
    jevTarget: null,
    evaluation: { status: "idle", provider: null, probability: null, elapsedMs: null, inputTokens: null, posture: null, risk: null, error: null },
    winner: null,
    battleEvent: null,
  };
}

function createMatch(): MatchState {
  return {
    ...createReadyMatch(),
    phase: "playing",
    player: createArenaState(),
    jev: createArenaState(),
    evaluation: { status: "thinking", provider: null, probability: null, elapsedMs: null, inputTokens: null, posture: null, risk: null, error: null },
    battleEvent: null,
  };
}

/**
 * Candidate ids are only meaningful for the board/context that produced
 * them. Gravity may move the active piece while a Gateway request is in
 * flight, so the revision intentionally excludes the active x/y pose but
 * includes every value that changes candidate geometry or attack scoring.
 */
function getJevDecisionRevision(arena: ArenaState) {
  return JSON.stringify({
    board: arena.board,
    queue: arena.queue.slice(0, 5),
    hold: arena.hold,
    canHold: arena.canHold,
    pendingGarbage: arena.pendingGarbage,
    combo: arena.combo,
    backToBack: arena.backToBack,
    activePiece: arena.active?.piece ?? null,
  });
}

function resolveArenaSteps(previous: MatchState, playerStep: ArenaStep, jevStep: ArenaStep): MatchState {
  let player = playerStep.arena;
  let jev = jevStep.arena;
  if (playerStep.attackSent > 0) jev = addPendingGarbage(jev, playerStep.attackSent);
  if (jevStep.attackSent > 0) player = addPendingGarbage(player, jevStep.attackSent);

  const attacks = [
    playerStep.attackSent > 0
      ? { target: "jev" as const, lines: playerStep.attackSent, clearType: playerStep.clearType }
      : null,
    jevStep.attackSent > 0
      ? { target: "player" as const, lines: jevStep.attackSent, clearType: jevStep.clearType }
      : null,
  ].filter((event): event is NonNullable<typeof event> => event !== null);
  const battleEvent = attacks.length
    ? { ...attacks[attacks.length - 1], id: (previous.battleEvent?.id ?? 0) + 1 }
    : previous.battleEvent;

  const playerOut = player.gameOver;
  const jevOut = jev.gameOver;
  const winner: Winner = playerOut && jevOut ? "draw" : playerOut ? "jev" : jevOut ? "you" : null;
  const jevTarget = previous.jevTarget?.pieceId === jev.active?.id ? previous.jevTarget : null;
  return {
    ...previous,
    player,
    jev,
    jevTarget,
    phase: winner ? "finished" : previous.phase,
    winner,
    battleEvent,
  };
}

function noArenaStep(arena: ArenaState): ArenaStep {
  return {
    arena,
    attackSent: 0,
    attackPower: 0,
    garbageCancelled: 0,
    damageReceived: 0,
    clearType: "none",
    locked: false,
    spawnedPieceId: null,
  };
}

function formatScore(score: number) {
  return String(score).padStart(6, "0");
}

function phaseText(phase: MatchPhase, winner: Winner) {
  if (phase === "ready") return "Ready when you are";
  if (phase === "paused") return "Match paused";
  if (phase === "error") return "Gateway decision failed";
  if (phase === "finished") {
    if (winner === "you") return "You win";
    if (winner === "jev") return "Jev wins";
    return "Draw";
  }
  return "Match in progress";
}

function gameOverLabel(reason: ArenaState["gameOverReason"]) {
  if (reason === "spawn-blocked") return "BLOCK OUT";
  if (reason === "lock-out") return "LOCK OUT";
  if (reason === "garbage-overflow") return "GARBAGE OUT";
  return "TOP OUT";
}

function matchResultDetail(winner: Winner, playerReason: ArenaState["gameOverReason"], jevReason: ArenaState["gameOverReason"]) {
  if (winner === "you") return `Jev ${gameOverLabel(jevReason)}`;
  if (winner === "jev") return `You ${gameOverLabel(playerReason)}`;
  return `You ${gameOverLabel(playerReason)} · Jev ${gameOverLabel(jevReason)}`;
}

function evaluationText(status: JevStatus) {
  switch (status) {
    case "thinking":
      return "choosing a legal placement";
    case "guiding":
      return "moving toward the selected placement";
    case "late":
      return "gravity passed the selected placement";
    case "fallback":
      return "using a verified legal rescue";
    case "error":
      return "decision unavailable";
    default:
      return "waiting for the match";
  }
}

export function TetrisGame() {
  const [match, setMatch] = useState<MatchState>(createReadyMatch);
  const [strategy, setStrategy] = useState<TetrisStrategy | null>("safe");
  const [strategyText, setStrategyText] = useState(STRATEGY_TEXT.safe);
  const matchRef = useRef(match);
  const strategyTextRef = useRef(STRATEGY_TEXT.safe);
  const sessionRef = useRef(0);
  const activeAbortRef = useRef<AbortController | null>(null);
  const jevRequestInFlightRef = useRef(false);
  const jevRequestedPieceIdRef = useRef(0);
  const jevRequestSequenceRef = useRef(0);
  const aiActionElapsedRef = useRef(0);
  const frameRef = useRef<() => void>(() => undefined);
  const playerActionRef = useRef<(action: ArenaAction) => void>(() => undefined);
  const pauseRef = useRef<() => void>(() => undefined);

  function updateMatch(next: MatchState | ((current: MatchState) => MatchState)) {
    const updated = typeof next === "function" ? next(matchRef.current) : next;
    matchRef.current = updated;
    setMatch(updated);
  }

  function makeJevTarget(
    pieceId: number,
    placement: NonNullable<ReturnType<typeof chooseFallbackPlacement>>,
    confidence: number | null,
    origin: JevTargetOrigin = confidence === null ? "fallback" : "jev",
    originReason: string | null = null,
  ): NonNullable<JevTarget> {
    return {
      pieceId,
      piece: placement.piece,
      x: placement.x,
      y: placement.y,
      rotation: placement.rotation,
      lastActionWasRotation: placement.lastActionWasRotation,
      useHold: placement.source === "hold",
      confidence,
      linesCleared: placement.linesCleared,
      technique: placement.technique,
      tSpin: placement.tSpin,
      outgoingAttack: placement.outgoingAttack,
      garbageCancelled: placement.garbageCancelled,
      origin,
      originReason,
    };
  }

  function setJevDecisionTarget(sessionId: number, pieceId: number, target: JevTarget) {
    if (sessionId !== sessionRef.current) return;
    updateMatch((current) => {
      if (current.phase === "finished" || current.phase === "ready" || current.phase === "error") return current;
      const isCurrentPiece = current.jev.active?.id === pieceId;
      const selectedTarget = isCurrentPiece && target && !target.useHold && current.jev.active && findPosePath(current.jev.board, current.jev.active, target) === null
        ? chooseFallbackPlacement(current.jev, false)
        : null;
      const effectiveTarget = selectedTarget
        ? makeJevTarget(pieceId, selectedTarget, null, "fallback", "Jevの選択手が現在の姿勢から到達不能になったため再計画しました。")
        : target;
      return {
        ...current,
        jevTarget: isCurrentPiece ? effectiveTarget : null,
        evaluation: {
          ...current.evaluation,
          status: isCurrentPiece ? (selectedTarget ? "late" : "guiding") : "late",
        },
      };
    });
  }

  function chooseFallbackPlacement(arena: ArenaState, allowHold = true) {
    const active = arena.active;
    if (!active) return null;
    const legalMoves = getBattlePlacements(arena.board, active.piece, active, getJevDecisionContext(arena));
    const playableMoves = allowHold ? legalMoves : legalMoves.filter((move) => move.source === "play");
    const candidates = playableMoves.length > 0 ? playableMoves : legalMoves;
    if (candidates.length === 0) return null;
    const ranked = [...candidates].sort((left, right) => {
      const leftRisk =
        left.holes * 100 + left.maxHeight * 5 + left.bumpiness * 2 + left.centerHeight * 4 + left.centerHoles * 60 + (left.centerStackRisk === "high" ? 180 : left.centerStackRisk === "medium" ? 45 : 0) - left.linesCleared * 60 - left.garbageCellsCleared * 45 - left.garbageCancelled * 80 - left.outgoingAttack * 10;
      const rightRisk =
        right.holes * 100 + right.maxHeight * 5 + right.bumpiness * 2 + right.centerHeight * 4 + right.centerHoles * 60 + (right.centerStackRisk === "high" ? 180 : right.centerStackRisk === "medium" ? 45 : 0) - right.linesCleared * 60 - right.garbageCellsCleared * 45 - right.garbageCancelled * 80 - right.outgoingAttack * 10;
      return leftRisk - rightRisk
        || right.outgoingAttack - left.outgoingAttack
        || right.garbageCancelled - left.garbageCancelled
        || right.linesCleared - left.linesCleared
        || left.maxHeight - right.maxHeight;
    });
    // A Gateway failure must not turn Jev into a random player. Keep the
    // best legal rescue deterministically, with attack and garbage digging
    // breaking ties after survival metrics.
    return ranked[0];
  }

  function continueWithFallback(sessionId: number, requestedPieceId: number, reason: string, actionUrl?: string) {
    if (sessionId !== sessionRef.current) return;
    const current = matchRef.current;
    if (current.phase === "finished" || current.phase === "ready") return;
    const active = current.jev.active;
    // A delayed failure must never be assigned to the piece that spawned
    // after this request. The next piece will be requested by finally().
    if (!active || active.id !== requestedPieceId) return;

    const fallback = chooseFallbackPlacement(current.jev);
    jevRequestedPieceIdRef.current = active.id;
    updateMatch({
      ...current,
      jevTarget: fallback
        ? makeJevTarget(active.id, fallback, null, "fallback", reason)
        : null,
      evaluation: {
        ...current.evaluation,
        status: "fallback",
        probability: null,
        elapsedMs: null,
        inputTokens: null,
        posture: null,
        risk: null,
        error: fallback
          ? `${reason} 合法なローカル候補から継続します。`
          : `${reason} 合法な配置がないため、盤面の自然なゲームオーバー判定に任せます。`,
        actionUrl,
      },
    });
  }

  async function requestJevChoice(sessionId: number, arena: ArenaState, retry = false) {
    const active = arena.active;
    if (!active || sessionId !== sessionRef.current || jevRequestInFlightRef.current) return;
    if (!retry && active.id <= jevRequestedPieceIdRef.current) return;

    jevRequestInFlightRef.current = true;
    jevRequestedPieceIdRef.current = active.id;
    const requestId = jevRequestSequenceRef.current + 1;
    jevRequestSequenceRef.current = requestId;
    const requestPieceId = active.id;
    const requestPiece = active.piece;
    const requestRevision = getJevDecisionRevision(arena);
    const requestOpponent = getJevOpponentSnapshot(matchRef.current.player);
    const requestOpponentRevision = getJevDecisionRevision(matchRef.current.player);
    let retryForStaleSnapshot = false;
    let requestTimedOut = false;
    const controller = new AbortController();
    const requestTimeoutId = window.setTimeout(() => {
      requestTimedOut = true;
      controller.abort();
    }, JEV_REQUEST_TIMEOUT_MS);
    activeAbortRef.current = controller;
    const requestedAt = performance.now();
    const decisionContext = getJevDecisionContext(arena);
    const legalAtRequest = getBattlePlacements(arena.board, active.piece, active, decisionContext);
    const isRequestSnapshotCurrent = () => {
      const current = matchRef.current;
      const currentActive = current.jev.active;
      if (current.phase !== "playing" || !currentActive) return false;
      return currentActive.id === requestPieceId
        && currentActive.piece === requestPiece
        && getJevDecisionRevision(current.jev) === requestRevision
        && getJevDecisionRevision(current.player) === requestOpponentRevision;
    };
    updateMatch((current) => ({
      ...current,
      evaluation: { ...current.evaluation, status: "thinking", posture: null, risk: null, error: null, actionUrl: undefined },
    }));

    try {
      const response = await fetch("/api/tetris/choose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          board: arena.board,
          currentPiece: active.piece,
          active: { x: active.x, y: active.y, rotation: active.rotation, lastActionWasRotation: active.lastActionWasRotation },
          decisionContext,
          opponent: requestOpponent,
          strategy: strategyTextRef.current,
        }),
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => ({}))) as MoveApiResponse;
      if (sessionId !== sessionRef.current || requestId !== jevRequestSequenceRef.current) return;
      if (requestTimedOut) {
        throw new Error("Jevの応答待ち時間を超えました。");
      }
      // Gravity is allowed to move the active pose, but a changed board,
      // queue, hold state, or garbage counter invalidates the candidate set.
      // Ask Jev again for the same piece instead of applying an old answer.
      if (!isRequestSnapshotCurrent()) {
        retryForStaleSnapshot = matchRef.current.phase === "playing" && Boolean(matchRef.current.jev.active);
        return;
      }
      if (!response.ok) {
        throw new Error(payload.error ?? "Jevの手の選択に失敗しました。", { cause: payload.actionUrl });
      }
      const selected = legalAtRequest.find((move) => move.id === payload.move?.id);
      if (!selected) throw new Error("Jevが返した手を合法手として確認できませんでした。");
      const probability =
        typeof payload.probability === "number" && Number.isFinite(payload.probability)
          ? Math.min(1, Math.max(0, payload.probability))
          : null;
      setJevDecisionTarget(sessionId, active.id, {
        ...makeJevTarget(active.id, selected, probability, "jev"),
      });
      updateMatch((current) => ({
        ...current,
        evaluation: {
          ...current.evaluation,
          probability,
          elapsedMs: typeof payload.elapsedMs === "number" ? payload.elapsedMs : Math.round(performance.now() - requestedAt),
          inputTokens: typeof payload.usage?.inputTokens === "number" ? payload.usage.inputTokens : null,
          provider: typeof payload.provider === "string" ? payload.provider : current.evaluation.provider,
          posture: typeof payload.posture === "string" ? payload.posture : null,
          risk: typeof payload.risk === "string" ? payload.risk : null,
        },
      }));
    } catch (caught) {
      if (sessionId !== sessionRef.current || (controller.signal.aborted && !requestTimedOut)) return;
      // Do not let an error from an old snapshot replace a newer piece with a
      // fallback target. The finally block will request the current piece (or
      // retry this one after a context change).
      if (!isRequestSnapshotCurrent()) {
        retryForStaleSnapshot = matchRef.current.phase === "playing" && Boolean(matchRef.current.jev.active);
        return;
      }
      const error = requestTimedOut
        ? new Error(`Jevの応答が${JEV_REQUEST_TIMEOUT_MS / 1000}秒以内に返らなかったため、安全なローカル手へ切り替えます。`)
        : caught instanceof Error ? caught : new Error("Jevへの接続に失敗しました。");
      const actionUrl = typeof error.cause === "string" ? error.cause : undefined;
      continueWithFallback(sessionId, requestPieceId, error.message, actionUrl);
    } finally {
      window.clearTimeout(requestTimeoutId);
      if (sessionId === sessionRef.current) {
        jevRequestInFlightRef.current = false;
        activeAbortRef.current = null;
        const current = matchRef.current;
        if (current.phase === "playing" && current.jev.active) {
          const samePieceNeedsRetry = retryForStaleSnapshot && current.jev.active.id === requestPieceId;
          const newerPieceNeedsRequest = current.jev.active.id > jevRequestedPieceIdRef.current;
          if (samePieceNeedsRetry || newerPieceNeedsRequest) {
            void requestJevChoice(sessionId, current.jev, samePieceNeedsRetry);
          }
        }
      }
    }
  }

  function publishSteps(previous: MatchState, playerStep: ArenaStep, jevStep: ArenaStep, sessionId: number) {
    const next = resolveArenaSteps(previous, playerStep, jevStep);
    updateMatch(next);
    if (
      jevStep.spawnedPieceId !== null &&
      next.phase === "playing" &&
      next.jev.active?.id === jevStep.spawnedPieceId
    ) {
      void requestJevChoice(sessionId, next.jev);
    }
  }

  function performPlayerAction(action: ArenaAction) {
    const current = matchRef.current;
    if (current.phase !== "playing") return;
    const playerStep = applyArenaAction(current.player, action);
    publishSteps(current, playerStep, noArenaStep(current.jev), sessionRef.current);
  }

  function togglePause() {
    const current = matchRef.current;
    if (current.phase === "playing") {
      updateMatch({ ...current, phase: "paused" });
    } else if (current.phase === "paused") {
      updateMatch({ ...current, phase: "playing" });
      if (current.jev.active && current.jev.active.id > jevRequestedPieceIdRef.current) {
        void requestJevChoice(sessionRef.current, current.jev);
      }
    }
  }

  function startMatch() {
    sessionRef.current += 1;
    activeAbortRef.current?.abort();
    activeAbortRef.current = null;
    jevRequestInFlightRef.current = false;
    jevRequestedPieceIdRef.current = 0;
    jevRequestSequenceRef.current = 0;
    aiActionElapsedRef.current = 0;
    const sessionId = sessionRef.current;
    const next = createMatch();
    updateMatch(next);
    void requestJevChoice(sessionId, next.jev);
  }

  function resetMatch() {
    sessionRef.current += 1;
    activeAbortRef.current?.abort();
    activeAbortRef.current = null;
    jevRequestInFlightRef.current = false;
    jevRequestedPieceIdRef.current = 0;
    jevRequestSequenceRef.current = 0;
    aiActionElapsedRef.current = 0;
    updateMatch(createReadyMatch());
  }

  function retryJevChoice() {
    const current = matchRef.current;
    if (current.phase !== "error" || !current.jev.active) return;
    const sessionId = sessionRef.current;
    updateMatch({
      ...current,
      phase: "playing",
      evaluation: { ...current.evaluation, status: "thinking", posture: null, risk: null, error: null, actionUrl: undefined },
    });
    jevRequestInFlightRef.current = false;
    void requestJevChoice(sessionId, current.jev, true);
  }

  function runFrame() {
    const current = matchRef.current;
    if (current.phase !== "playing") return;
    const playerTick = tickArena(current.player, 32);
    const jevTick = tickArena(current.jev, 32);
    let next = resolveArenaSteps(current, playerTick, jevTick);
    let jevSpawnedPieceId = jevTick.spawnedPieceId;
    if (next.phase === "playing" && next.jevTarget && next.jev.active?.id === next.jevTarget.pieceId) {
      aiActionElapsedRef.current += 32;
      if (aiActionElapsedRef.current >= JEV_ACTION_INTERVAL_MS) {
        aiActionElapsedRef.current = 0;
        let active = next.jev.active;
        const target = next.jevTarget;
        let effectiveTarget = target;

        // A low or missing probability is not a reason to wait while gravity
        // keeps changing the pose. It is a reason to refuse the model target
        // and select a deterministic, playable rescue before any input is
        // applied. The rescue is labeled separately so its confidence cannot
        // be mistaken for Jev's choice in the HUD.
        const modelTargetIsUncertain = next.evaluation.status === "guiding"
          && target.origin === "jev"
          && (target.confidence === null || target.confidence < JEV_CONFIDENCE_THRESHOLD);
        if (modelTargetIsUncertain) {
          const rescue = chooseFallbackPlacement(next.jev, false);
          if (!rescue) {
            next = {
              ...next,
              jevTarget: null,
              evaluation: {
                ...next.evaluation,
                status: "fallback",
                probability: null,
                posture: null,
                risk: null,
                error: "Jevの確信度が低く、現在のピースに安全な合法手がありません。",
              },
            };
            updateMatch(next);
            return;
          }
          const confidenceLabel = target.confidence === null ? "未取得" : `${Math.round(target.confidence * 100)}%`;
          effectiveTarget = makeJevTarget(
            active.id,
            rescue,
            null,
            "fallback",
            `Jevの確信度が${confidenceLabel}のため、確定せず安全候補へ切り替えました。`,
          );
          next = {
            ...next,
            jevTarget: effectiveTarget,
            evaluation: {
              ...next.evaluation,
              status: "fallback",
              probability: null,
              posture: null,
              risk: null,
              error: effectiveTarget.originReason,
            },
          };
        }

        if (effectiveTarget.useHold) {
          const holdStep = applyArenaAction(next.jev, "hold");
          const heldActive = holdStep.arena.active;
          if (
            holdStep.spawnedPieceId !== null
            && heldActive
            && heldActive.piece === effectiveTarget.piece
          ) {
            const holdTarget = { ...effectiveTarget, pieceId: holdStep.spawnedPieceId, useHold: false };
            next = resolveArenaSteps(next, noArenaStep(next.player), holdStep);
            next = { ...next, jevTarget: holdTarget };
            jevRequestedPieceIdRef.current = holdStep.spawnedPieceId;
            aiActionElapsedRef.current = 0;
            if (!next.jev.active) {
              updateMatch(next);
              return;
            }
            active = next.jev.active;
          } else {
            const rescue = chooseFallbackPlacement(next.jev, false);
            if (rescue) {
              const fallbackTarget = makeJevTarget(
                active.id,
                rescue,
                null,
                "fallback",
                "HOLD後のピースが選択時と一致しないため、現在のピースで再計画しました。",
              );
              next = {
                ...next,
                jevTarget: fallbackTarget,
                evaluation: { ...next.evaluation, status: "fallback", probability: null, posture: null, risk: null, error: fallbackTarget.originReason },
              };
            } else {
              next = { ...next, jevTarget: null, evaluation: { ...next.evaluation, status: "fallback", error: "HOLDを適用できる合法手がありません。" } };
            }
          }
          // A valid HOLD already consumed this frame. A failed HOLD has been
          // replaced with a normal target and continues through the path code.
          if (next.jevTarget?.useHold) {
            updateMatch(next);
            return;
          }
          const nextTarget = next.jevTarget;
          if (!nextTarget || next.jev.active?.id !== nextTarget.pieceId) {
            updateMatch(next);
            return;
          }
          effectiveTarget = nextTarget;
        }

        let action: ArenaAction | null = null;
        let path = effectiveTarget.piece === active.piece
          ? findPosePath(next.jev.board, active, effectiveTarget)
          : null;
        if (path === null) {
          const rescue = chooseFallbackPlacement(next.jev, false);
          if (rescue) {
            effectiveTarget = makeJevTarget(
              active.id,
              rescue,
              null,
              "fallback",
              "選択された着地点が現在の姿勢から到達不能になったため再計画しました。",
            );
            next = {
              ...next,
              jevTarget: effectiveTarget,
              evaluation: { ...next.evaluation, status: "late", probability: null, error: effectiveTarget.originReason },
            };
            path = findPosePath(next.jev.board, active, effectiveTarget);
          }
        }

        const currentLandings = getLegalPlacements(next.jev.board, active.piece, active);
        const targetLanding = currentLandings.some(
          (move) =>
            move.x === effectiveTarget.x &&
            move.y === effectiveTarget.y &&
            move.rotation === effectiveTarget.rotation &&
            move.lastActionWasRotation === effectiveTarget.lastActionWasRotation,
        );
        const samePose = active.x === effectiveTarget.x && active.rotation === effectiveTarget.rotation;
        const directDropMatchesTarget = samePose && getDropY(next.jev.board, active) === effectiveTarget.y;
        const rotationHistoryMatchesTarget = active.lastActionWasRotation === effectiveTarget.lastActionWasRotation;
        const targetIsTrusted = effectiveTarget.origin === "fallback"
          || (effectiveTarget.confidence !== null && effectiveTarget.confidence >= JEV_CONFIDENCE_THRESHOLD);
        // Once a trusted model target (or a local rescue) has the exact
        // current landing, commit immediately. A low-confidence model target
        // never reaches this branch because it was replaced above.
        if (targetIsTrusted && targetLanding && directDropMatchesTarget && rotationHistoryMatchesTarget) {
          action = "hardDrop";
        } else if (path && path.length > 0) {
          action = path[0];
          if (action === "softDrop") {
            // Soft drop is an intermediate maneuver for getting under a
            // shelf, not a blind hold-to-bottom command. Preview the exact
            // input and keep it only when the selected pose remains
            // reachable after that one-row descent.
            const previewInput = applyArenaAction(next.jev, "softDrop");
            const previewTick = previewInput.arena.active ? tickArena(previewInput.arena, 32) : previewInput;
            const previewArena = previewTick.arena;
            const previewActive = previewArena.active;
            const previewPath = previewActive && previewActive.id === effectiveTarget.pieceId
              ? findPosePath(previewArena.board, previewActive, effectiveTarget)
              : null;
            if (!previewActive || previewPath === null) {
              const rescue = chooseFallbackPlacement(next.jev, false);
              if (rescue) {
                effectiveTarget = makeJevTarget(
                  active.id,
                  rescue,
                  null,
                  "fallback",
                  "ソフトドロップ後に重力で目標へ届かなくなるため再計画しました。",
                );
                next = {
                  ...next,
                  jevTarget: effectiveTarget,
                  evaluation: { ...next.evaluation, status: "late", probability: null, error: effectiveTarget.originReason },
                };
                path = findPosePath(next.jev.board, active, effectiveTarget);
                action = path && path.length > 0 ? path[0] : null;
              } else {
                action = null;
              }
            }
          }
        }
        if (action) {
          const jevActionStep = applyArenaAction(next.jev, action);
          jevSpawnedPieceId = jevActionStep.spawnedPieceId ?? jevSpawnedPieceId;
          next = resolveArenaSteps(next, noArenaStep(next.player), jevActionStep);
        }
      }
    } else {
      aiActionElapsedRef.current = 0;
    }
    updateMatch(next);
    if (
      jevSpawnedPieceId !== null &&
      next.phase === "playing" &&
      next.jev.active?.id === jevSpawnedPieceId
    ) {
      void requestJevChoice(sessionRef.current, next.jev);
    }
  }

  function changeStrategyText(value: string) {
    strategyTextRef.current = value;
    setStrategyText(value);
    const matchingPreset = STRATEGY_OPTIONS.find((option) => STRATEGY_TEXT[option.id] === value);
    setStrategy(matchingPreset?.id ?? null);
  }

  function chooseStrategy(nextStrategy: TetrisStrategy) {
    strategyTextRef.current = STRATEGY_TEXT[nextStrategy];
    setStrategyText(STRATEGY_TEXT[nextStrategy]);
    setStrategy(nextStrategy);
  }

  useEffect(() => {
    playerActionRef.current = performPlayerAction;
    pauseRef.current = togglePause;
    frameRef.current = runFrame;
  });

  useEffect(() => {
    const timer = window.setInterval(() => frameRef.current(), 32);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      const key = event.key.toLowerCase();
      const actions: Record<string, ArenaAction> = {
        arrowleft: "left",
        arrowright: "right",
        arrowdown: "softDrop",
        arrowup: "rotateCW",
        x: "rotateCW",
        z: "rotateCCW",
        " ": "hardDrop",
        c: "hold",
        shift: "hold",
      };
      const action = actions[key];
      if (action) {
        event.preventDefault();
        if (!event.repeat || action === "left" || action === "right" || action === "softDrop") {
          playerActionRef.current(action);
        }
      } else if (key === "escape") {
        event.preventDefault();
        pauseRef.current();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    return () => {
      sessionRef.current += 1;
      activeAbortRef.current?.abort();
    };
  }, []);

  const startLabel = match.phase === "finished" ? "Play again" : "Start match";
  const showStart = match.phase === "ready" || match.phase === "finished";
  const statusText = phaseText(match.phase, match.winner);
  const resultDetail = match.phase === "finished" && match.winner
    ? matchResultDetail(match.winner, match.player.gameOverReason, match.jev.gameOverReason)
    : null;
  const evaluation = match.evaluation;
  const battleEventId = match.battleEvent?.id ?? 0;
  const battleAttacker = match.battleEvent?.target === "player" ? "JEV ATTACK" : "YOUR ATTACK";

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div key={`scene-${battleEventId}`} className={`tetris-scene${match.battleEvent ? " tetris-scene--impact" : ""}`}>
        <div className="mx-auto w-full max-w-[1120px] px-3 pb-10 pt-5 sm:px-6 sm:pt-8">
        <header className="mb-6 flex items-center justify-between border-b border-border-subtle pb-4">
          <Link className="flex items-center gap-3" href="/" aria-label="Jev Tetris home">
            <span className="grid size-8 grid-cols-2 grid-rows-2 gap-0.5" aria-hidden="true">
              <i className="rounded-[1px] bg-[#00f0f0]" />
              <i className="rounded-[1px] bg-[#f0d000]" />
              <i className="rounded-[1px] bg-[#a000f0]" />
              <i className="rounded-[1px] bg-[#00d000]" />
            </span>
            <span className="font-mono text-[11px] tracking-[0.12em] text-muted-foreground">JEV / TETRIS</span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden font-mono text-[10px] tracking-[0.1em] text-muted-foreground sm:inline">LOCAL VERSUS</span>
            <ThemeToggle />
          </div>
        </header>

        <section className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">1 player / AI opponent</p>
            <h1 className="text-h1">Jev vs You</h1>
          </div>
          <p className="max-w-md text-body2 text-muted-foreground">
            操作・判断中も両方のピースは落下し続けます。ライン消去で相手におじゃまブロックを送ります。
          </p>
        </section>

        <section className={`tetris-match-bar mb-3 flex flex-wrap items-center justify-between gap-3 px-3 py-2.5${match.phase === "finished" ? " tetris-match-bar--finished" : ""}`} aria-live="polite">
          <div>
            <p className="text-h3">{statusText}{match.phase === "finished" ? " · MATCH COMPLETE" : ""}</p>
            {resultDetail ? <p className="mt-0.5 font-mono text-[10px] tracking-[0.08em] text-muted-foreground">{resultDetail} · 盤面を表示中</p> : null}
            <p className="mt-0.5 text-caption text-muted-foreground">
              {resultDetail ? "この状態で停止" : `gravity ${getGravityIntervalMs(match.player.level).toFixed(0)} ms / row · lock delay 500 ms`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {showStart ? (
              <Button type="button" onClick={startMatch} className="min-h-9 rounded-sm px-3 text-xs">
                <Play className="mr-2 size-4" /> {startLabel}
              </Button>
            ) : match.phase === "error" ? (
              <Button type="button" onClick={retryJevChoice} className="min-h-9 rounded-sm px-3 text-xs">
                <RotateCw className="mr-2 size-4" /> Retry Jev
              </Button>
            ) : (
              <Button type="button" onClick={togglePause} className="min-h-9 rounded-sm px-3 text-xs">
                {match.phase === "paused" ? <Play className="mr-2 size-4" /> : <Pause className="mr-2 size-4" />}
                {match.phase === "paused" ? "Resume" : "Pause"}
              </Button>
            )}
            {match.phase !== "ready" ? (
              <Button type="button" variant="outline" onClick={resetMatch} className="min-h-9 rounded-sm px-3 text-xs">
                Reset
              </Button>
            ) : null}
          </div>
        </section>

        <section className="grid grid-cols-2 gap-2.5 sm:gap-4" aria-label="Versus playfields">
          <ArenaPanel title="YOU" side="player" arena={match.player} phase={match.phase} battleEvent={match.battleEvent} />
          <ArenaPanel
            title="JEV"
            side="jev"
            arena={match.jev}
            phase={match.phase}
            battleEvent={match.battleEvent}
            evaluation={evaluation}
            jevTarget={match.jevTarget}
          />
        </section>

        <section className="mt-4 grid gap-3 md:grid-cols-2">
          <div>
            <PlayerControls onAction={performPlayerAction} disabled={match.phase !== "playing"} />
          </div>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <section className="tetris-panel p-3 sm:p-4" aria-label="Jev strategy">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="text-h3">Jev strategy</h2>
                <span className="font-mono text-[9px] text-muted-foreground">{strategyText.length}/500</span>
              </div>
              <textarea
                aria-label="Strategy for Jev"
                className="tetris-strategy-input"
                maxLength={500}
                onChange={(event) => changeStrategyText(event.target.value)}
                rows={3}
                value={strategyText}
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {STRATEGY_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={strategy === option.id}
                    className={`tetris-chip${strategy === option.id ? " is-selected" : ""}`}
                    onClick={() => chooseStrategy(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </section>

            <section className="tetris-panel p-3 sm:p-4" aria-label="Jev provider telemetry">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="text-h3">Jev provider telemetry</h2>
                <span className={`status-indicator status-indicator--${evaluation.status}`}>
                  <i /> {evaluation.status.toUpperCase()}
                </span>
              </div>
              <p className="text-body2">{evaluationText(evaluation.status)}</p>
              <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground">
                provider {evaluation.provider ?? "auto / waiting"}
              </p>
              {evaluation.posture || evaluation.risk ? (
                <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground">
                  posture {evaluation.posture ?? "—"} · risk {evaluation.risk ?? "—"}
                </p>
              ) : null}
              <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border-subtle pt-2">
                <Metric label="PROBABILITY" value={evaluation.probability === null ? "—" : `${(evaluation.probability * 100).toFixed(1)}%`} />
                <Metric label="LATENCY" value={evaluation.elapsedMs === null ? "—" : `${evaluation.elapsedMs} ms`} />
                <Metric label="INPUT TOKENS" value={evaluation.inputTokens === null ? "—" : String(evaluation.inputTokens)} />
              </div>
              <p className="mt-2 text-caption text-muted-foreground">通常は1 provider evaluation。盤面が変われば再評価し、応答中も重力は進みます。</p>
              {evaluation.error ? (
                <div className="mt-3 border border-border-strong p-2 text-caption" role="alert">
                  <p>{evaluation.error}</p>
                  {evaluation.actionUrl ? <a className="mt-1 inline-block underline" href={evaluation.actionUrl} target="_blank" rel="noreferrer">Open Gateway credits</a> : null}
                </div>
              ) : null}
            </section>
          </div>
        </section>

          <footer className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle pt-3 text-caption text-muted-foreground">
            <span>← → move · ↓ soft drop · ↑ / X rotate · Z reverse · Space hard drop · C hold</span>
          </footer>
        </div>
      </div>
      {match.battleEvent ? (
        <div key={`global-impact-${battleEventId}`} className="battle-impact-global" aria-hidden="true">
          <div className="battle-impact-global__content">
            <strong>+{match.battleEvent.lines}</strong>
            <span>{battleAttacker}</span>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function ArenaPanel({
  title,
  side,
  arena,
  phase,
  battleEvent,
  evaluation,
  jevTarget,
}: {
  title: string;
  side: "player" | "jev";
  arena: ArenaState;
  phase: MatchPhase;
  battleEvent: BattleEvent | null;
  evaluation?: EvaluationInfo;
  jevTarget?: JevTarget;
}) {
  const impact = battleEvent?.target === side ? battleEvent : null;
  const techniqueLabel = arena.lastTSpin !== "none" && arena.lastClearType === "none"
    ? `${arena.lastTSpin === "full" ? "T-SPIN" : "MINI T-SPIN"}`
    : formatTechnique(arena.lastClearType);
  return (
    <section className={`tetris-panel min-w-0 p-2 sm:p-3 ${side === "player" ? "tetris-panel--player" : "tetris-panel--jev"}`} aria-label={`${title} Tetris board`}>
      <div className="mb-2 flex items-center justify-between gap-1.5 px-0.5">
        <h2 className="font-mono text-[11px] font-medium tracking-[0.12em] sm:text-xs">{title}</h2>
        <span className="font-mono text-[9px] text-muted-foreground">{arena.gameOver ? gameOverLabel(arena.gameOverReason) : phase === "playing" ? "LIVE" : phase.toUpperCase()}</span>
      </div>
      <div className="tetris-board-stage">
        <TetrisBoardView arena={arena} impact={impact} />
        {side === "jev" && evaluation ? <JevDecisionLog arena={arena} evaluation={evaluation} target={jevTarget ?? null} overlay /> : null}
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1.5">
        <Metric label="SCORE" value={formatScore(arena.score)} />
        <Metric label="LINES" value={String(arena.lines).padStart(2, "0")} />
        <Metric label="LEVEL" value={String(arena.level).padStart(2, "0")} />
        <Metric label="INCOMING" mobileLabel="IN" value={String(arena.pendingGarbage).padStart(2, "0")} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-border-subtle pt-2">
        <MiniPieceCard label="HOLD" piece={arena.hold} />
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
          {arena.queue.slice(0, 3).map((piece, index) => <MiniPieceCard key={`${index}:${piece}`} label={index === 0 ? "NEXT" : ""} piece={piece} compact />)}
        </div>
      </div>
      <div className="mt-2 flex justify-between border-t border-border-subtle pt-1.5 font-mono text-[9px] text-muted-foreground">
        <span>{techniqueLabel} · {arena.lastLinesCleared} LINE{arena.lastLinesCleared === 1 ? "" : "S"}</span>
        <span>ATTACK +{arena.lastAttack}{arena.combo > 1 ? ` · REN ${arena.combo}` : ""}{arena.backToBack ? " · B2B" : ""}</span>
      </div>
    </section>
  );
}

function JevDecisionLog({
  arena,
  evaluation,
  target,
  overlay = false,
}: {
  arena: ArenaState;
  evaluation: EvaluationInfo;
  target: JevTarget;
  overlay?: boolean;
}) {
  const active = arena.active;
  const boardProfile = getJevDecisionContext(arena).boardProfile;
  const probability = evaluation.probability === null ? "—" : `${(evaluation.probability * 100).toFixed(0)}%`;
  const targetProbability = target?.confidence === null || target?.confidence === undefined
    ? "—"
    : `${(target.confidence * 100).toFixed(0)}%`;
  const plannedPiece = target?.piece ?? active?.piece ?? null;
  const plannedLabel = target
    ? `${target.origin === "fallback" ? "安全手として" : target.useHold ? "HOLDして" : "そのまま"} ${target.piece} を置く`
    : evaluation.status === "thinking" ? "候補を比較中" : "次の手を待機中";
  const intentLabel = target ? describeJevIntent(target) : "盤面を読み取り中";
  const directDropReady = target ? isDirectJevDropReady(arena, target) : false;
  const actionLabel = evaluation.status === "fallback"
    ? "安全な合法手で継続"
    : evaluation.status === "guiding"
      ? directDropReady ? "着地位置一致 · ハードドロップ" : target?.useHold ? "HOLD → 回転・移動 → 設置" : "回転・移動 → 設置"
      : target?.confidence !== null && target?.confidence !== undefined && target.confidence >= JEV_CONFIDENCE_THRESHOLD
        ? "確信度が高い · ハードドロップ候補"
        : evaluationText(evaluation.status);
  const step = getJevDecisionStep(evaluation.status, target, arena);
  return (
    <section className={`jev-decision-log${overlay ? " jev-decision-log--overlay" : ""}`} aria-label="Jev decision stream" aria-live="polite">
      <div className="jev-decision-log__head">
        <span><b className="jev-decision-log__brand">JEV // LIVE DECISION</b><small>P{String(arena.pieces + 1).padStart(2, "0")}</small></span>
        <span className={`status-indicator status-indicator--${evaluation.status}`}><i />{formatDecisionStatus(evaluation.status)}</span>
      </div>
      <div className="jev-decision-flow" aria-label="Jev decision steps">
        {(["look", "choose", "move", "lock"] as const).map((flowStep, index) => (
          <Fragment key={flowStep}>
            <div className={`jev-decision-flow__step${step === flowStep ? " is-active" : ""}${stepIndex(step) > index ? " is-done" : ""}`}>
              <span>{index + 1}</span>
              <strong>{decisionStepLabel(flowStep)}</strong>
            </div>
            {index < 3 ? <i className="jev-decision-flow__arrow" aria-hidden="true">›</i> : null}
          </Fragment>
        ))}
      </div>
      <div className="jev-decision-cards">
        <div className="jev-decision-card jev-decision-card--input">
          <span className="jev-decision-card__label">見ている</span>
          <div className="jev-decision-card__input-row">
            {active?.piece ? <MiniPiece piece={active.piece} /> : <span className="jev-decision-card__empty">—</span>}
            <div>
              <strong>{active?.piece ?? "—"} ピース</strong>
              <small>NEXT {arena.queue.slice(0, 3).join(" · ") || "—"} · HOLD {arena.hold ?? "なし"}</small>
              <small>おじゃま {arena.pendingGarbage} 行</small>
              <small>中央積み {centerRiskLabel(boardProfile.centerStackRisk)} · 退避 {shiftLabel(boardProfile.recommendedShift)} · 高さ {boardProfile.centerHeight}</small>
            </div>
          </div>
        </div>
        <div className="jev-decision-card jev-decision-card--plan">
          <span className="jev-decision-card__label">選んだ狙い</span>
          <div className="jev-decision-card__plan-row">
            {plannedPiece ? <MiniPiece piece={plannedPiece} /> : <span className="jev-decision-card__empty">?</span>}
            <div>
              <strong>{plannedLabel}</strong>
              <small>{intentLabel}</small>
              <small>{target ? `R${target.rotation + 1} · 列${target.x + 1} · 行${target.y + 1}` : "—"} · 確信度 {target ? targetProbability : probability}</small>
            </div>
          </div>
        </div>
      </div>
      <div className="jev-decision-action"><span className="jev-decision-card__label">いま実行中</span><strong>{actionLabel}</strong><small>{evaluation.posture ?? "姿勢を評価中"} · {evaluation.risk ?? "危険度を評価中"}{evaluation.elapsedMs === null ? "" : ` · ${evaluation.elapsedMs}ms`}</small></div>
    </section>
  );
}

function describeJevIntent(target: NonNullable<JevTarget>) {
  const technique = target.technique !== "none" ? formatTechnique(target.technique) : target.tSpin !== "none" ? `${target.tSpin === "full" ? "T-SPIN" : "MINI T-SPIN"}` : target.linesCleared > 0 ? `${target.linesCleared} LINE CLEAR` : "積み上げ安定化";
  if (target.outgoingAttack > 0) return `${technique} · +${target.outgoingAttack} 攻撃`;
  if (target.garbageCancelled > 0) return `${technique} · おじゃま${target.garbageCancelled}行を相殺`;
  return technique;
}

function centerRiskLabel(risk: "low" | "medium" | "high") {
  return risk === "high" ? "高" : risk === "medium" ? "中" : "低";
}

function shiftLabel(shift: "none" | "left" | "right" | "split") {
  return shift === "left" ? "左" : shift === "right" ? "右" : shift === "split" ? "左右分散" : "不要";
}

function isDirectJevDropReady(arena: ArenaState, target: NonNullable<JevTarget>) {
  const active = arena.active;
  return Boolean(
    active &&
      !target.useHold &&
      active.piece === target.piece &&
      active.x === target.x &&
      active.rotation === target.rotation &&
      active.lastActionWasRotation === target.lastActionWasRotation &&
      getDropY(arena.board, active) === target.y,
  );
}

function getJevDecisionStep(status: JevStatus, target: JevTarget, arena: ArenaState): "look" | "choose" | "move" | "lock" {
  if (status === "thinking" || status === "idle" || !target) return "look";
  if (status === "guiding" && isDirectJevDropReady(arena, target)) return "lock";
  if (status === "guiding" || status === "late" || status === "fallback") return "move";
  if (target.confidence !== null && target.confidence >= JEV_CONFIDENCE_THRESHOLD) return "lock";
  return "choose";
}

function stepIndex(step: "look" | "choose" | "move" | "lock") {
  return ["look", "choose", "move", "lock"].indexOf(step);
}

function decisionStepLabel(step: "look" | "choose" | "move" | "lock") {
  return { look: "見る", choose: "選ぶ", move: "動く", lock: "固める" }[step];
}

function formatDecisionStatus(status: JevStatus) {
  return { idle: "待機", thinking: "分析中", guiding: "実行中", late: "再計画", fallback: "代替手", error: "停止" }[status];
}

function formatTechnique(technique: ClearTechnique) {
  if (technique === "tetris") return "TETRIS";
  if (technique === "perfect-clear") return "PERFECT CLEAR";
  if (technique.startsWith("t-spin")) return technique.replaceAll("-", " ").toUpperCase();
  if (technique === "none") return "READY";
  return technique.toUpperCase();
}

function TetrisBoardView({ arena, impact }: { arena: ArenaState; impact: BattleEvent | null }) {
  const active = arena.active;
  const visual = arena.visual;
  const settling = visual !== null && visual.remainingMs <= 300;
  const clearing = visual !== null && !settling;
  const displayBoard = clearing ? visual.lockedBoard : settling ? emptyBoard() : arena.board;
  const clearRows = clearing ? new Set(visual.clearedRows) : null;
  const baseShape = active ? getPieceMatrix(active.piece, 0) : null;
  const ghostY = active ? getDropY(arena.board, active) : 0;
  const boardCells = displayBoard.map((row, rowIndex) => row.map((cell, columnIndex) => {
    const isClearing = clearRows?.has(rowIndex) ?? false;
    return (
      <span
        key={`${rowIndex}:${columnIndex}`}
        aria-hidden="true"
        className={`tetris-cell${cell ? ` tetris-cell--${cell.toLowerCase()}` : ""}${isClearing ? " tetris-cell--clearing" : ""}`}
      />
    );
  }));

  return (
    <div
      className={`tetris-board${clearing ? " tetris-board--clearing" : ""}`}
      role="img"
      aria-label={`${arena.lines} lines cleared, level ${arena.level}, ${arena.pendingGarbage} incoming garbage rows`}
    >
      {boardCells}
      {visual ? (
        <div className={`tetris-settling-layer${settling ? " is-settling" : ""}`} aria-hidden="true">
          {visual.settlementCells.map((cell) => (
            <span
              key={cell.key}
              className={`tetris-cell tetris-cell--${cell.piece.toLowerCase()} tetris-settling-cell`}
              style={{
                left: `${cell.x * 10}%`,
                top: `${(settling ? cell.toY : cell.fromY) * 5}%`,
                "--tetris-settle-duration": "280ms",
              } as CSSProperties}
            />
          ))}
        </div>
      ) : null}
      {active && baseShape && ghostY > active.y ? (
        <div
          className={`tetris-piece tetris-ghost-piece tetris-piece--${active.piece.toLowerCase()}`}
          aria-hidden="true"
          style={pieceStyle(active, baseShape, ghostY, active.rotation * 90)}
        >
          {baseShape.flatMap((row, rowIndex) => row.map((filled, columnIndex) =>
            filled ? <span key={`${rowIndex}:${columnIndex}`} className={`tetris-cell tetris-cell--${active.piece.toLowerCase()}`} style={{ gridColumn: columnIndex + 1, gridRow: rowIndex + 1 }} /> : null,
          ))}
        </div>
      ) : null}
      {active && baseShape ? (
        <div
          className={`tetris-piece tetris-active-piece tetris-piece--${active.piece.toLowerCase()}`}
          aria-hidden="true"
          style={pieceStyle(active, baseShape, active.y, active.rotation * 90)}
        >
          {baseShape.flatMap((row, rowIndex) => row.map((filled, columnIndex) =>
            filled ? <span key={`${rowIndex}:${columnIndex}`} className={`tetris-cell tetris-cell--${active.piece.toLowerCase()}`} style={{ gridColumn: columnIndex + 1, gridRow: rowIndex + 1 }} /> : null,
          ))}
        </div>
      ) : null}
      {arena.pendingGarbage > 0 ? <div className="incoming-meter" aria-hidden="true" style={{ height: `${Math.min(100, arena.pendingGarbage * 5)}%` }} /> : null}
      {impact ? (
        <div key={impact.id} className="battle-impact" aria-live="polite">
          <strong>+{impact.lines}</strong>
          <span>{formatTechnique(impact.clearType)} DAMAGE</span>
        </div>
      ) : null}
    </div>
  );
}

function pieceStyle(active: NonNullable<ArenaState["active"]>, shape: number[][], y: number, degrees = 0): CSSProperties {
  return {
    left: `${active.x * 10}%`,
    top: `${y * 5}%`,
    width: `${shape[0].length * 10}%`,
    height: `${shape.length * 5}%`,
    gridTemplateColumns: `repeat(${shape[0].length}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${shape.length}, minmax(0, 1fr))`,
    transform: `rotate(${degrees}deg)`,
  };
}

function MiniPieceCard({ label, piece, compact = false }: { label: string; piece: PieceType | null; compact?: boolean }) {
  return (
    <div className={`mini-piece-card${compact ? " is-compact" : ""}`}>
      {label ? <span className="font-mono text-[8px] tracking-[0.08em] text-muted-foreground">{label}</span> : null}
      {piece ? <MiniPiece piece={piece} /> : <span className="mini-piece-placeholder">—</span>}
    </div>
  );
}

function MiniPiece({ piece }: { piece: PieceType }) {
  const shape = getPieceMatrix(piece);
  return (
    <span className="mini-piece" style={{ gridTemplateColumns: `repeat(${shape[0].length}, 1fr)`, gridTemplateRows: `repeat(${shape.length}, 1fr)` }} aria-hidden="true">
      {shape.flatMap((row, rowIndex) => row.map((filled, columnIndex) =>
        filled ? <i key={`${rowIndex}:${columnIndex}`} className={`tetris-cell tetris-cell--${piece.toLowerCase()}`} style={{ gridColumn: columnIndex + 1, gridRow: rowIndex + 1 }} /> : null,
      ))}
    </span>
  );
}

function PlayerControls({ onAction, disabled }: { onAction: (action: ArenaAction) => void; disabled: boolean }) {
  function button(action: ArenaAction, label: string, icon: ReactNode, className = "") {
    return (
      <button
        type="button"
        className={`tetris-control-button ${className}`}
        disabled={disabled}
        aria-label={label}
        title={label}
        onClick={() => onAction(action)}
      >
        {icon}
      </button>
    );
  }
  return (
    <section className="tetris-panel p-3 sm:p-4" aria-label="Your controls">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-h3">Controls</h2>
        <span className="font-mono text-[9px] text-muted-foreground">KEYBOARD / TOUCH</span>
      </div>
      <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
        {button("rotateCCW", "Rotate counterclockwise · Z", <RotateCcw className="size-4" />)}
        {button("rotateCW", "Rotate clockwise · Up or X", <RotateCw className="size-4" />)}
        {button("hold", "Hold · C", <span className="font-mono text-xs">H</span>)}
        {button("hardDrop", "Hard drop · Space", <ArrowDown className="size-4" />, "is-primary")}
        {button("left", "Move left · Left arrow", <ArrowLeft className="size-4" />)}
        {button("softDrop", "Soft drop · Down arrow", <ArrowDown className="size-4" />)}
        {button("right", "Move right · Right arrow", <ArrowRight className="size-4" />)}
        {button("rotateCW", "Rotate clockwise · Up or X", <ArrowUp className="size-4" />)}
      </div>
      <p className="mt-2 text-caption text-muted-foreground">移動・回転中も重力が進みます。着地後は最大15回のロック猶予リセットがあります。</p>
    </section>
  );
}

function Metric({ label, mobileLabel, value }: { label: string; mobileLabel?: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate font-mono text-[8px] tracking-[0.08em] text-muted-foreground sm:text-[9px]">
        {mobileLabel ? <><span className="sm:hidden">{mobileLabel}</span><span className="hidden sm:inline">{label}</span></> : label}
      </dt>
      <dd className="mt-0.5 truncate font-mono text-[10px] tabular-nums sm:text-xs">{value}</dd>
    </div>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="size-8 rounded-sm p-0 text-muted-foreground"
      aria-label="表示モードを切り替え"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun className="hidden size-4 dark:block" />
      <Moon className="size-4 dark:hidden" />
    </Button>
  );
}
