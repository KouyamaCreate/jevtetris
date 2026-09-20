import {
  boardToCompactRows,
  getBattlePlacements,
  isPieceType,
  isJevDecisionContext,
  isJevOpponentSnapshot,
  isTetrisBoard,
  type BattlePlacement,
} from "@/lib/tetris";
import { evaluateJev, getJevProviderStatus, JevProviderError } from "@/lib/jev-provider";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 24_000;
const MAX_STRATEGY_LENGTH = 500;

export async function POST(request: Request) {
  const providerStatus = getJevProviderStatus();
  if (!providerStatus.configured) {
    return Response.json(
      {
        error: "Jevプロバイダが設定されていません。READMEの環境変数設定から1つ選んでください。",
        code: "JEV_PROVIDER_NOT_CONFIGURED",
        provider: providerStatus.selection,
        available: providerStatus.available,
        missing: providerStatus.missing,
      },
      { status: 503 },
    );
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return Response.json({ error: "ゲーム状態が大きすぎます。", code: "REQUEST_TOO_LARGE" }, { status: 413 });
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return Response.json({ error: "JSON形式のリクエストが必要です。", code: "INVALID_JSON" }, { status: 400 });
  }

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return Response.json({ error: "ゲーム状態のJSONオブジェクトが必要です。", code: "INVALID_GAME_STATE" }, { status: 400 });
  }

  const body = input as {
    board?: unknown;
    currentPiece?: unknown;
    strategy?: unknown;
    active?: unknown;
    decisionContext?: unknown;
    opponent?: unknown;
  };
  if (!isTetrisBoard(body.board) || !isPieceType(body.currentPiece)) {
    return Response.json({ error: "盤面またはピースの形式が不正です。", code: "INVALID_GAME_STATE" }, { status: 400 });
  }
  if (typeof body.strategy !== "string" || !body.strategy.trim() || body.strategy.length > MAX_STRATEGY_LENGTH) {
    return Response.json(
      { error: `戦略は1〜${MAX_STRATEGY_LENGTH}文字で入力してください。`, code: "INVALID_STRATEGY" },
      { status: 400 },
    );
  }
  if (!isJevDecisionContext(body.decisionContext)) {
    return Response.json(
      { error: "Jevへ渡すNEXT・HOLD・重力・ロック状態が不正です。", code: "INVALID_DECISION_CONTEXT" },
      { status: 400 },
    );
  }
  if (body.opponent !== undefined && !isJevOpponentSnapshot(body.opponent)) {
    return Response.json({ error: "相手の公開盤面情報が不正です。", code: "INVALID_OPPONENT_STATE" }, { status: 400 });
  }

  let active: { x: number; y: number; rotation: number; lastActionWasRotation?: boolean } | undefined;
  if (body.active !== undefined) {
    if (!body.active || typeof body.active !== "object" || Array.isArray(body.active)) {
      return Response.json({ error: "操作中のピース位置が不正です。", code: "INVALID_ACTIVE_PIECE" }, { status: 400 });
    }
    const candidate = body.active as Record<string, unknown>;
    if (
      !Number.isInteger(candidate.x) ||
      !Number.isInteger(candidate.y) ||
      !Number.isInteger(candidate.rotation) ||
      Number(candidate.x) < -4 ||
      Number(candidate.x) > 10 ||
      Number(candidate.y) < -4 ||
      Number(candidate.y) >= 20 ||
      Number(candidate.rotation) < 0 ||
      Number(candidate.rotation) > 3 ||
      (candidate.lastActionWasRotation !== undefined && typeof candidate.lastActionWasRotation !== "boolean")
    ) {
      return Response.json({ error: "操作中のピース位置が不正です。", code: "INVALID_ACTIVE_PIECE" }, { status: 400 });
    }
    active = {
      x: Number(candidate.x),
      y: Number(candidate.y),
      rotation: Number(candidate.rotation),
      ...(candidate.lastActionWasRotation === undefined ? {} : { lastActionWasRotation: Boolean(candidate.lastActionWasRotation) }),
    };
  }

  const strategy = body.strategy.trim();
  const decisionContext = body.decisionContext;
  const legalMoves = getBattlePlacements(body.board, body.currentPiece, active, decisionContext);
  if (legalMoves.length === 0) {
    return Response.json({ error: "次のピースを置ける場所がありません。", code: "TOP_OUT" }, { status: 409 });
  }

  const criteria = Object.fromEntries(legalMoves.map((move) => [move.id, describeMove(move)]));
  const postureCriteria = {
    survive: "Reduce immediate top-out risk, cancel incoming garbage, and preserve safe continuations.",
    dig: "Prioritize opening and clearing garbage while keeping a route to the surface.",
    build: "Build a sustainable attack with a smooth surface and future T-Spin, B2B, or combo potential.",
    pressure: "Convert a safe opportunity into outgoing damage when the opponent is vulnerable.",
    finish: "Take a justified short-term risk to threaten a near-term top-out, while retaining recovery options.",
  };
  const riskCriteria = {
    low: "The board has headroom, few holes, and several safe continuations.",
    medium: "Recovery requires a careful placement, garbage cancellation, or a specific next piece.",
    high: "Immediate defense or garbage digging is needed to avoid topping out.",
  };
  const startedAt = performance.now();

  try {
    const result = await evaluateJev({
      state: {
        game: "Tetris",
        board: boardToCompactRows(body.board),
        currentPiece: body.currentPiece,
        activePiece: active,
        decisionContext,
        opponent: body.opponent ?? null,
        strategy,
        executionContract: "The client applies one selected movement input every 32ms while gravity continues. A low or missing probability is treated as an uncertain strategic target: the client will discard it and choose a deterministic safe legal placement instead of waiting or blindly dropping it. For an accepted target, when the current column and rotation already produce the selected landing row, it hard-drops immediately; probability is not a physical landing guarantee and must not be converted into a long soft-drop descent. Soft drop is a one-row intermediate maneuver for a reachable under-shelf route, not a command to hold down until the bottom. The client previews the next gravity tick after each soft drop and re-plans from the current pose if gravity or the lock timer makes the selected landing unreachable.",
        boardReadingRule: "Read decisionContext.boardProfile before choosing. centerStackRisk=high means the central four columns are becoming a trap; prefer a legal shift toward the lower side or a garbage-digging clear. Do not keep building in the center only to avoid an immediate hole. This is a self-check about a known failure mode, not a forced move.",
        legalMoves: legalMoves.map(({ id, x, y, rotation, source, piece, lastActionWasRotation, linesCleared, garbageCellsCleared, tSpin, technique, perfectClear, attackPower, outgoingAttack, garbageCancelled, holes, aggregateHeight, bumpiness, maxHeight, centerHeight, centerFilledCells, centerHoles, centerStackRisk }) => ({
          id,
          source,
          piece,
          lastActionWasRotation,
          column: x + 1,
          landingRow: y + 1,
          rotationDegrees: rotation * 90,
          linesCleared,
          garbageCellsCleared,
          tSpin,
          technique,
          perfectClear,
          attackPower,
          outgoingAttack,
          garbageCancelled,
          holes,
          aggregateHeight,
          bumpiness,
          maxHeight,
          centerHeight,
          centerFilledCells,
          centerHoles,
          centerStackRisk,
        })),
        coordinateRule: "legalMoves.column and legalMoves.landingRow are 1-based for readability; the move ID is authoritative. decisionContext.nextPieces is ordered with the next spawn first. decisionContext.boardProfile.columnTopRows uses 0-based board rows from the top, and null means an empty column. lockRemainingMs is null until the active piece is grounded.",
        rule: "Choose exactly one atomic action ID. An action may play the current piece or hold it and play the listed replacement placement. The game code validates and applies the selected action.",
        ruleset: "guideline-battle-v1: normal 1/2/3/4 line attack 0/1/2/4, T-Spin 2/4/6, combo bonus, back-to-back bonus, perfect-clear bonus, and line-plus-attack garbage cancellation.",
      },
      questions: {
        action: {
          type: "choice",
          instructions: "Use the shared board, opponent snapshot, decisionContext.boardProfile, execution contract, and strategy together. First check whether the center stack is medium/high risk. Compare stability, garbage digging, attack timing, T-Spins, B2B, combos, NEXT, HOLD, and how quickly the route can be completed. When the center is high risk, actively look for a safe left/right shift or a garbage-digging clear instead of continuing to stack centrally. Prefer a short reachable route when the lock timer is low. Choose exactly one listed atomic action ID; do not invent an ID.",
          criteria,
        },
        posture: {
          type: "choice",
          instructions: "Independently classify the tactical posture that best describes the current decision. This is a diagnostic parallel judgment; the action choice remains authoritative.",
          criteria: postureCriteria,
        },
        risk: {
          type: "choice",
          instructions: "Independently classify the near-term top-out risk from the shared state. This is a diagnostic parallel judgment; the action choice remains authoritative.",
          criteria: riskCriteria,
        },
      },
      maxRetries: 0,
      abortSignal: request.signal,
      gatewayTags: ["app:jev-tetris", "feature:piece-choice"],
    });

    const answer = result.answers.action;
    if (answer.type !== "choice") {
      return Response.json({ error: "JevからChoice形式の回答が返りませんでした。", code: "INVALID_MODEL_ANSWER" }, { status: 502 });
    }

    const selectedMove = legalMoves.find((move) => move.id === answer.choice);
    if (!selectedMove) {
      return Response.json({ error: "Jevの回答が合法手に含まれていません。", code: "INVALID_MODEL_ANSWER" }, { status: 502 });
    }

    const probability = answer.probabilities?.[answer.choice];
    const postureAnswer = result.answers.posture;
    const riskAnswer = result.answers.risk;
    return Response.json({
      model: result.response.modelId,
      provider: result.provider,
      move: selectedMove,
      probability: typeof probability === "number" ? probability : undefined,
      posture: postureAnswer?.type === "choice" ? postureAnswer.choice : undefined,
      risk: riskAnswer?.type === "choice" ? riskAnswer.choice : undefined,
      usage: result.usage,
      elapsedMs: Math.round(performance.now() - startedAt),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    const providerError = error instanceof JevProviderError ? error : null;
    const needsCredits = providerError?.status === 402 || message.includes("free tier") || message.includes("paid credits");
    const status = providerError?.status ?? (needsCredits
      ? 402
      : message.includes("rate") || message.includes("429")
        ? 429
        : message.includes("auth") || message.includes("api key") || message.includes("unauthorized")
          ? 401
          : 502);

    return Response.json(
      {
        error: needsCredits
          ? "選択したJevプロバイダの無料枠またはクレジット上限に達しました。プロバイダ側の利用枠を確認してください。"
          : status === 429
            ? "Jevプロバイダのレート制限に達しました。少し待って再実行してください。"
            : status === 401
              ? "Jevプロバイダの認証に失敗しました。環境変数のAPIキーを確認してください。"
            : "Jevの手の選択に失敗しました。安全なローカル合法手で試合を継続します。",
        code: providerError?.code ?? (needsCredits ? "PROVIDER_CREDITS_REQUIRED" : status === 429 ? "RATE_LIMITED" : status === 401 ? "PROVIDER_AUTH_FAILED" : "EVALUATION_FAILED"),
        provider: providerError?.provider ?? providerStatus.provider,
      },
      { status },
    );
  }
}

function describeMove(move: BattlePlacement): string {
  const rotation = move.rotation * 90;
  const hold = move.source === "hold" ? `hold ${move.piece} then ` : `play ${move.piece} `;
  const clearLabel = move.tSpin === "none" ? move.technique : `${move.tSpin} t-spin${move.technique === "none" ? "" : ` (${move.technique})`}`;
  return `${hold}rotation ${rotation} degrees, column ${move.x + 1}, landing row ${move.y + 1}; ${clearLabel}; clears ${move.linesCleared} lines (${move.garbageCellsCleared} garbage cells); attack ${move.attackPower}, outgoing ${move.outgoingAttack}, cancels ${move.garbageCancelled}; resulting holes ${move.holes}, stack height ${move.maxHeight}, aggregate height ${move.aggregateHeight}, surface roughness ${move.bumpiness}, center risk ${move.centerStackRisk} (height ${move.centerHeight}, holes ${move.centerHoles})`;
}
