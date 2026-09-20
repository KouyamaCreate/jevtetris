export const TETRIS_WIDTH = 10;
export const TETRIS_HEIGHT = 20;

export const PIECE_TYPES = ["I", "O", "T", "S", "Z", "J", "L"] as const;
export type PieceType = (typeof PIECE_TYPES)[number];
export type TetrisCell = PieceType | "G";
export type TetrisBoard = (TetrisCell | null)[][];
export type TetrisStrategy = "safe" | "aggressive" | "chaos";
export type RotationDirection = -1 | 1;
export type ArenaAction = "left" | "right" | "softDrop" | "hardDrop" | "rotateCW" | "rotateCCW" | "hold";
export type TSpinKind = "none" | "mini" | "full";
export type CenterStackRisk = "low" | "medium" | "high";
export type BoardProfile = {
  columnHeights: number[];
  columnTopRows: (number | null)[];
  columnHoles: number[];
  centerHeight: number;
  centerFilledCells: number;
  centerHoles: number;
  centerStackRisk: CenterStackRisk;
  recommendedShift: "none" | "left" | "right" | "split";
};
export type GameOverReason = "spawn-blocked" | "lock-out" | "garbage-overflow";
export type ClearTechnique =
  | "none"
  | "single"
  | "double"
  | "triple"
  | "tetris"
  | "t-spin-mini-single"
  | "t-spin-mini-double"
  | "t-spin-single"
  | "t-spin-double"
  | "t-spin-triple"
  | "perfect-clear";

export type ActivePiece = {
  id: number;
  piece: PieceType;
  x: number;
  y: number;
  rotation: number;
  lastActionWasRotation: boolean;
};

export type LegalPlacement = {
  id: string;
  x: number;
  y: number;
  rotation: number;
  lastActionWasRotation: boolean;
  linesCleared: number;
  garbageCellsCleared: number;
  tSpin: TSpinKind;
  technique: ClearTechnique;
  perfectClear: boolean;
  holes: number;
  aggregateHeight: number;
  bumpiness: number;
  maxHeight: number;
  centerHeight: number;
  centerFilledCells: number;
  centerHoles: number;
  centerStackRisk: CenterStackRisk;
};

export type BattlePlacement = LegalPlacement & {
  source: "play" | "hold";
  piece: PieceType;
  attackPower: number;
  outgoingAttack: number;
  garbageCancelled: number;
};

export type SettlementCell = {
  key: string;
  piece: TetrisCell;
  x: number;
  fromY: number;
  toY: number;
};

export type LineClearEffect = {
  lockedBoard: TetrisBoard;
  clearedRows: number[];
  settlementCells: SettlementCell[];
  remainingMs: number;
};

export type ArenaState = {
  board: TetrisBoard;
  active: ActivePiece | null;
  queue: PieceType[];
  hold: PieceType | null;
  canHold: boolean;
  score: number;
  lines: number;
  level: number;
  pieces: number;
  combo: number;
  backToBack: boolean;
  pendingGarbage: number;
  gravityElapsedMs: number;
  lockElapsedMs: number;
  lockResets: number;
  visual: LineClearEffect | null;
  gameOver: boolean;
  gameOverReason: GameOverReason | null;
  lastLinesCleared: number;
  lastAttack: number;
  lastAttackPower: number;
  lastGarbageCancelled: number;
  lastClearType: ClearTechnique;
  lastTSpin: TSpinKind;
};

export type ArenaStep = {
  arena: ArenaState;
  attackSent: number;
  attackPower: number;
  garbageCancelled: number;
  damageReceived: number;
  clearType: ClearTechnique;
  locked: boolean;
  spawnedPieceId: number | null;
};

export type ActivePlacement = Pick<ActivePiece, "x" | "y" | "rotation"> & {
  lastActionWasRotation?: boolean;
};

export type JevDecisionContext = {
  boardProfile: BoardProfile;
  nextPieces: PieceType[];
  holdPiece: PieceType | null;
  canHold: boolean;
  pendingGarbage: number;
  score: number;
  lines: number;
  level: number;
  combo: number;
  backToBack: boolean;
  pieces: number;
  lastLinesCleared: number;
  lastAttack: number;
  lastAttackPower: number;
  lastGarbageCancelled: number;
  lastClearType: ClearTechnique;
  lastTSpin: TSpinKind;
  gravityIntervalMs: number;
  nextGravityInMs: number;
  isGrounded: boolean;
  lockDelayMs: number;
  lockRemainingMs: number | null;
  lockResetsRemaining: number;
};

export type JevOpponentSnapshot = {
  board: string[];
  boardProfile: BoardProfile;
  activePiece: PieceType | null;
  nextPieces: PieceType[];
  holdPiece: PieceType | null;
  pendingGarbage: number;
  combo: number;
  backToBack: boolean;
  lastClearType: ClearTechnique;
  lastAttack: number;
  holes: number;
  maxHeight: number;
};

const CLEAR_TECHNIQUE_SET = new Set<ClearTechnique>([
  "none",
  "single",
  "double",
  "triple",
  "tetris",
  "t-spin-mini-single",
  "t-spin-mini-double",
  "t-spin-single",
  "t-spin-double",
  "t-spin-triple",
  "perfect-clear",
]);

export function isClearTechnique(value: unknown): value is ClearTechnique {
  return typeof value === "string" && CLEAR_TECHNIQUE_SET.has(value as ClearTechnique);
}

const PIECE_TYPE_SET = new Set<string>(PIECE_TYPES);
const BASE_SHAPES: Record<PieceType, number[][]> = {
  I: [
    [0, 0, 0, 0],
    [1, 1, 1, 1],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  O: [
    [1, 1],
    [1, 1],
  ],
  T: [
    [0, 1, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  S: [
    [0, 1, 1],
    [1, 1, 0],
    [0, 0, 0],
  ],
  Z: [
    [1, 1, 0],
    [0, 1, 1],
    [0, 0, 0],
  ],
  J: [
    [1, 0, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  L: [
    [0, 0, 1],
    [1, 1, 1],
    [0, 0, 0],
  ],
};

const ROTATIONS = Object.fromEntries(
  PIECE_TYPES.map((piece) => [piece, createRotations(BASE_SHAPES[piece])]),
) as Record<PieceType, number[][][]>;

// SRS kick offsets in screen coordinates (positive y points down).
const JLSTZ_KICKS: Record<string, readonly [number, number][]> = {
  "0>1": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  "1>0": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  "1>2": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  "2>1": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  "2>3": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  "3>2": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  "3>0": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  "0>3": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
};

const I_KICKS: Record<string, readonly [number, number][]> = {
  "0>1": [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
  "1>0": [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
  "1>2": [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
  "2>1": [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
  "2>3": [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
  "3>2": [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
  "3>0": [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
  "0>3": [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
};

const GRAVITY_G = [
  0.01667, 0.021017, 0.026977, 0.035256, 0.04693, 0.06361, 0.0879, 0.1236, 0.1775, 0.2598,
  0.388, 0.59, 0.92, 1.46, 2.36, 3.91, 6.61, 11.43, 20.23,
];
const LOCK_DELAY_MS = 500;
const MAX_LOCK_RESETS = 15;
const LINE_CLEAR_EFFECT_MS = 720;

export function emptyBoard(): TetrisBoard {
  return Array.from({ length: TETRIS_HEIGHT }, () => Array<TetrisCell | null>(TETRIS_WIDTH).fill(null));
}

export function isPieceType(value: unknown): value is PieceType {
  return typeof value === "string" && PIECE_TYPE_SET.has(value);
}

export function isTetrisBoard(value: unknown): value is TetrisBoard {
  return (
    Array.isArray(value) &&
    value.length === TETRIS_HEIGHT &&
    value.every(
      (row) =>
        Array.isArray(row) &&
        row.length === TETRIS_WIDTH &&
        row.every((cell) => cell === null || isPieceType(cell) || cell === "G"),
    )
  );
}

export function getPieceMatrix(piece: PieceType, rotation = 0): number[][] {
  const shapes = ROTATIONS[piece];
  const index = ((rotation % shapes.length) + shapes.length) % shapes.length;
  return shapes[index].map((row) => [...row]);
}

export function getSpawnX(piece: PieceType): number {
  const shape = ROTATIONS[piece][0];
  return Math.floor((TETRIS_WIDTH - shape[0].length) / 2);
}

export function getSpawnPiece(piece: PieceType, id = 1): ActivePiece {
  return {
    id,
    piece,
    rotation: 0,
    x: getSpawnX(piece),
    y: 0,
    lastActionWasRotation: false,
  };
}

export function createArenaState(): ArenaState {
  const bag = makeSevenBag();
  return {
    board: emptyBoard(),
    active: getSpawnPiece(bag[0]),
    queue: [...bag.slice(1), ...makeSevenBag()],
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

export function makeSevenBag(): PieceType[] {
  // Guideline Random Generator: every bag contains exactly one of each
  // tetromino, then the bag is shuffled before it is dealt.
  const bag = [...PIECE_TYPES];
  for (let index = bag.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [bag[index], bag[swapIndex]] = [bag[swapIndex], bag[index]];
  }
  return bag;
}

export function getGravityIntervalMs(level: number): number {
  const gravity = GRAVITY_G[Math.min(GRAVITY_G.length - 1, Math.max(0, Math.floor(level) - 1))];
  return Math.max(50, 1_000 / (60 * gravity));
}

export function getJevDecisionContext(arena: ArenaState): JevDecisionContext {
  const active = arena.active;
  const gravityIntervalMs = getGravityIntervalMs(arena.level);
  const boardProfile = getBoardProfile(arena.board);
  const isGrounded = active
    ? !canPlace(arena.board, getPieceMatrix(active.piece, active.rotation), active.x, active.y + 1)
    : false;

  return {
    boardProfile,
    nextPieces: arena.queue.slice(0, 5),
    holdPiece: arena.hold,
    canHold: arena.canHold,
    pendingGarbage: arena.pendingGarbage,
    score: arena.score,
    lines: arena.lines,
    level: arena.level,
    combo: arena.combo,
    backToBack: arena.backToBack,
    pieces: arena.pieces,
    lastLinesCleared: arena.lastLinesCleared,
    lastAttack: arena.lastAttack,
    lastAttackPower: arena.lastAttackPower,
    lastGarbageCancelled: arena.lastGarbageCancelled,
    lastClearType: arena.lastClearType,
    lastTSpin: arena.lastTSpin,
    gravityIntervalMs,
    nextGravityInMs: active ? Math.max(0, gravityIntervalMs - arena.gravityElapsedMs) : 0,
    isGrounded,
    lockDelayMs: LOCK_DELAY_MS,
    lockRemainingMs: active && isGrounded ? Math.max(0, LOCK_DELAY_MS - arena.lockElapsedMs) : null,
    lockResetsRemaining: Math.max(0, MAX_LOCK_RESETS - arena.lockResets),
  };
}

export function isJevDecisionContext(value: unknown): value is JevDecisionContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (!isBoardProfile(candidate.boardProfile)) return false;
  const nextPieces = candidate.nextPieces;
  if (!Array.isArray(nextPieces) || nextPieces.length > 5 || !nextPieces.every(isPieceType)) return false;
  if (candidate.holdPiece !== null && !isPieceType(candidate.holdPiece)) return false;
  if (typeof candidate.canHold !== "boolean" || typeof candidate.isGrounded !== "boolean") return false;

  const integerFields = [
    "pendingGarbage",
    "score",
    "lines",
    "level",
    "combo",
    "pieces",
    "lastLinesCleared",
    "lastAttack",
    "lastAttackPower",
    "lastGarbageCancelled",
    "lockDelayMs",
    "lockResetsRemaining",
  ];
  if (
    !integerFields.every(
      (field) => typeof candidate[field] === "number" && Number.isInteger(candidate[field]) && Number(candidate[field]) >= 0,
    )
  ) {
    return false;
  }
  if (typeof candidate.backToBack !== "boolean") return false;
  if (!isClearTechnique(candidate.lastClearType) || !["none", "mini", "full"].includes(String(candidate.lastTSpin))) return false;

  const timingFields = ["gravityIntervalMs", "nextGravityInMs"];
  if (!timingFields.every((field) => typeof candidate[field] === "number" && Number.isFinite(candidate[field]) && Number(candidate[field]) >= 0)) {
    return false;
  }
  if (Number(candidate.level) < 1 || Number(candidate.nextGravityInMs) > Number(candidate.gravityIntervalMs)) return false;
  return (
    candidate.lockRemainingMs === null ||
    (typeof candidate.lockRemainingMs === "number" &&
      Number.isFinite(candidate.lockRemainingMs) &&
      candidate.lockRemainingMs >= 0 &&
      candidate.lockRemainingMs <= Number(candidate.lockDelayMs))
  );
}

function isBoardProfile(value: unknown): value is BoardProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const profile = value as Record<string, unknown>;
  const arraysAreValid = ["columnHeights", "columnHoles"].every(
    (field) => Array.isArray(profile[field]) && profile[field].length === TETRIS_WIDTH && profile[field].every((item) => Number.isInteger(item) && Number(item) >= 0),
  );
  const topRows = profile.columnTopRows;
  if (!arraysAreValid || !Array.isArray(topRows) || topRows.length !== TETRIS_WIDTH || !topRows.every((item) => item === null || (Number.isInteger(item) && Number(item) >= 0 && Number(item) < TETRIS_HEIGHT))) return false;
  return (
    ["centerHeight", "centerFilledCells", "centerHoles"].every((field) => typeof profile[field] === "number" && Number.isInteger(profile[field]) && Number(profile[field]) >= 0) &&
    ["low", "medium", "high"].includes(String(profile.centerStackRisk)) &&
    ["none", "left", "right", "split"].includes(String(profile.recommendedShift))
  );
}

export function getLegalPlacements(
  board: TetrisBoard,
  piece: PieceType,
  start: ActivePlacement = { x: getSpawnX(piece), y: 0, rotation: 0 },
): LegalPlacement[] {
  const initial: SearchPlacement = {
    ...start,
    rotation: normalizeRotation(piece, start.rotation),
    lastActionWasRotation: start.lastActionWasRotation ?? false,
  };
  if (!canPlace(board, getPieceMatrix(piece, initial.rotation), initial.x, initial.y)) return [];

  const queue = [initial];
  const visited = new Set<string>([placementStateKey(initial)]);
  const placements = new Map<string, LegalPlacement>();

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    const shape = getPieceMatrix(piece, current.rotation);
    if (!canPlace(board, shape, current.x, current.y + 1)) {
      const suffix = current.lastActionWasRotation ? "-rotation" : "-normal";
      const id = `r${current.rotation}-x${current.x}-y${current.y}${suffix}`;
      const placed = lockBoard(board, piece, current.rotation, current.x, current.y, current.lastActionWasRotation);
      if (placed) {
        const metrics = getBoardMetrics(placed.board);
        const candidate: LegalPlacement = {
          id,
          x: current.x,
          y: current.y,
          rotation: current.rotation,
          lastActionWasRotation: current.lastActionWasRotation,
          linesCleared: placed.linesCleared,
          garbageCellsCleared: placed.garbageCellsCleared,
          tSpin: placed.tSpin,
          technique: placed.technique,
          perfectClear: placed.perfectClear,
          ...metrics,
        };
        const poseKey = `${candidate.rotation}:${candidate.x}:${candidate.y}`;
        const existing = placements.get(poseKey);
        // A normal and a final-rotation route can reach the same pose. Keep
        // the rotation route only when it changes the result into a T-Spin;
        // this keeps the Jev candidate set small without losing the tactic.
        if (!existing || (candidate.tSpin !== "none" && existing.tSpin === "none")) {
          placements.set(poseKey, candidate);
        }
      }
    }

    const nextStates = [
      { ...current, x: current.x - 1, lastActionWasRotation: false },
      { ...current, x: current.x + 1, lastActionWasRotation: false },
      // Gravity/soft drop is not a new player move for T-Spin detection; keep
      // the final-rotation marker until a lateral move or another action.
      { ...current, y: current.y + 1, lastActionWasRotation: current.lastActionWasRotation },
      ...(piece === "O" ? [] : [
        tryRotate(board, piece, current, 1),
        tryRotate(board, piece, current, -1),
      ].filter((state): state is ActivePlacement => state !== null).map((state) => ({ ...state, lastActionWasRotation: true }))),
    ];

    for (const next of nextStates) {
      const nextShape = getPieceMatrix(piece, next.rotation);
      if (!canPlace(board, nextShape, next.x, next.y)) continue;
      const key = placementStateKey(next);
      if (visited.has(key)) continue;
      visited.add(key);
      queue.push(next);
    }
  }

  return [...placements.values()].sort(
    (left, right) => left.rotation - right.rotation || left.x - right.x || left.y - right.y,
  );
}

export function findPosePath(
  board: TetrisBoard,
  active: ActivePiece,
  target: ActivePlacement,
): ArenaAction[] | null {
  const start: PathNode = {
    x: active.x,
    y: active.y,
    rotation: active.rotation,
    lastActionWasRotation: active.lastActionWasRotation,
    path: [],
  };
  const queue = [start];
  const visited = new Set<string>([placementStateKey(start)]);
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (
      current.x === target.x &&
      current.y === target.y &&
      current.rotation === target.rotation &&
      current.lastActionWasRotation === (target.lastActionWasRotation ?? false)
    ) return current.path;
    const base = {
      id: active.id,
      piece: active.piece,
      x: current.x,
      y: current.y,
      rotation: current.rotation,
      lastActionWasRotation: current.lastActionWasRotation,
    };
    const rotatedCW = tryRotate(board, active.piece, base, 1);
    const rotatedCCW = tryRotate(board, active.piece, base, -1);
    const nextStates: { state: ActivePlacement; action: ArenaAction }[] = [
      { state: { x: current.x - 1, y: current.y, rotation: current.rotation, lastActionWasRotation: false }, action: "left" },
      { state: { x: current.x + 1, y: current.y, rotation: current.rotation, lastActionWasRotation: false }, action: "right" },
      ...(rotatedCW ? [{ state: { ...rotatedCW, lastActionWasRotation: true }, action: "rotateCW" as const }] : []),
      ...(rotatedCCW ? [{ state: { ...rotatedCCW, lastActionWasRotation: true }, action: "rotateCCW" as const }] : []),
      // Prefer horizontal/rotation alignment before spending a row on an
      // explicit soft drop. A soft drop remains available for shelf and
      // overhang routes, but is no longer the default speed path.
      { state: { x: current.x, y: current.y + 1, rotation: current.rotation, lastActionWasRotation: current.lastActionWasRotation }, action: "softDrop" },
    ];
    for (const next of nextStates) {
      if (!canPlace(board, getPieceMatrix(active.piece, next.state.rotation), next.state.x, next.state.y)) continue;
      const key = placementStateKey(next.state);
      if (visited.has(key)) continue;
      visited.add(key);
      queue.push({
        ...next.state,
        lastActionWasRotation: next.state.lastActionWasRotation ?? false,
        path: [...current.path, next.action],
      });
    }
  }
  return null;
}

export function placePiece(
  board: TetrisBoard,
  piece: PieceType,
  placement: ActivePlacement,
): LockedPlacement | null {
  return lockBoard(board, piece, placement.rotation, placement.x, placement.y, placement.lastActionWasRotation ?? false);
}

export type LockedPlacement = {
  board: TetrisBoard;
  lockedBoard: TetrisBoard;
  clearedRows: number[];
  linesCleared: number;
  garbageCellsCleared: number;
  tSpin: TSpinKind;
  technique: ClearTechnique;
  perfectClear: boolean;
  holes: number;
  aggregateHeight: number;
  bumpiness: number;
  maxHeight: number;
};

export function scoreForLines(linesCleared: number, level: number): number {
  const baseScore: Record<number, number> = { 1: 100, 2: 300, 3: 500, 4: 800 };
  return (baseScore[linesCleared] ?? 0) * level;
}

export type VersusAttackOptions = {
  tSpin?: TSpinKind;
  backToBack?: boolean;
  perfectClear?: boolean;
};

/**
 * Guideline-style versus attack table. The Nintendo product pages establish
 * the battle concepts (multi-line attacks, combos, T-Spins and incoming
 * garbage); this table makes the numeric 1v1 rules explicit for this app.
 */
export function getVersusAttack(linesCleared: number, combo: number, options: VersusAttackOptions = {}): number {
  const tSpin = options.tSpin ?? "none";
  const baseNormal: Record<number, number> = { 1: 0, 2: 1, 3: 2, 4: 4 };
  const baseTSpin: Record<number, number> = { 0: 0, 1: 2, 2: 4, 3: 6 };
  const baseMini: Record<number, number> = { 0: 0, 1: 1, 2: 2 };
  const base = tSpin === "full" ? baseTSpin[linesCleared] ?? 0 : tSpin === "mini" ? baseMini[linesCleared] ?? 0 : baseNormal[linesCleared] ?? 0;
  // TETRIS 99's published examples award +1 on the second clear and +2 on
  // the fourth; this compact table preserves that progression.
  const comboBonus = Math.floor(combo / 2);
  const difficult = linesCleared === 4 || (tSpin !== "none" && linesCleared > 0);
  const backToBackBonus = difficult && options.backToBack ? 1 : 0;
  const perfectClearBonus = options.perfectClear ? 10 : 0;
  return base + comboBonus + backToBackBonus + perfectClearBonus;
}

export function getBattlePlacements(
  board: TetrisBoard,
  currentPiece: PieceType,
  active: ActivePlacement | undefined,
  context: Pick<JevDecisionContext, "canHold" | "holdPiece" | "nextPieces" | "combo" | "backToBack" | "pendingGarbage">,
): BattlePlacement[] {
  const candidates: BattlePlacement[] = [];
  const add = (source: "play" | "hold", piece: PieceType, placements: LegalPlacement[]) => {
    for (const placement of placements) {
      const actionId = source === "play" ? `play:${placement.id}` : `hold:${piece}:${placement.id}`;
      const attackPower = getVersusAttack(placement.linesCleared, placement.linesCleared > 0 ? context.combo + 1 : 0, {
        tSpin: placement.tSpin,
        backToBack: context.backToBack,
        perfectClear: placement.perfectClear,
      });
      // A cleared line always removes one warning block (TETRIS 99 rule);
      // stronger attacks can cancel their additional power as well.
      const garbageCancelled = Math.min(context.pendingGarbage, Math.max(placement.linesCleared, attackPower));
      candidates.push({
        ...placement,
        id: actionId,
        source,
        piece,
        attackPower,
        outgoingAttack: Math.max(0, attackPower - garbageCancelled),
        garbageCancelled,
      });
    }
  };

  add("play", currentPiece, getLegalPlacements(board, currentPiece, active));
  if (context.canHold) {
    const replacement = context.holdPiece ?? context.nextPieces[0];
    if (replacement) add("hold", replacement, getLegalPlacements(board, replacement));
  }
  return candidates;
}

export function getJevOpponentSnapshot(arena: ArenaState): JevOpponentSnapshot {
  const metrics = getBoardMetrics(arena.board);
  return {
    board: boardToCompactRows(arena.board),
    boardProfile: getBoardProfile(arena.board),
    activePiece: arena.active?.piece ?? null,
    nextPieces: arena.queue.slice(0, 5),
    holdPiece: arena.hold,
    pendingGarbage: arena.pendingGarbage,
    combo: arena.combo,
    backToBack: arena.backToBack,
    lastClearType: arena.lastClearType,
    lastAttack: arena.lastAttack,
    holes: metrics.holes,
    maxHeight: metrics.maxHeight,
  };
}

export function isJevOpponentSnapshot(value: unknown): value is JevOpponentSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate.board) &&
    candidate.board.length === TETRIS_HEIGHT &&
    candidate.board.every((row) => typeof row === "string" && row.length === TETRIS_WIDTH) &&
    isBoardProfile(candidate.boardProfile) &&
    (candidate.activePiece === null || isPieceType(candidate.activePiece)) &&
    Array.isArray(candidate.nextPieces) &&
    candidate.nextPieces.length <= 5 &&
    candidate.nextPieces.every(isPieceType) &&
    (candidate.holdPiece === null || isPieceType(candidate.holdPiece)) &&
    typeof candidate.pendingGarbage === "number" &&
    Number.isInteger(candidate.pendingGarbage) &&
    candidate.pendingGarbage >= 0 &&
    typeof candidate.combo === "number" &&
    Number.isInteger(candidate.combo) &&
    candidate.combo >= 0 &&
    typeof candidate.backToBack === "boolean" &&
    isClearTechnique(candidate.lastClearType) &&
    typeof candidate.lastAttack === "number" &&
    Number.isInteger(candidate.lastAttack) &&
    candidate.lastAttack >= 0 &&
    typeof candidate.holes === "number" &&
    Number.isInteger(candidate.holes) &&
    candidate.holes >= 0 &&
    typeof candidate.maxHeight === "number" &&
    Number.isInteger(candidate.maxHeight) &&
    candidate.maxHeight >= 0
  );
}

export function addPendingGarbage(arena: ArenaState, lines: number): ArenaState {
  if (lines <= 0 || arena.gameOver) return arena;
  return { ...arena, pendingGarbage: arena.pendingGarbage + lines };
}

export function tickArena(arena: ArenaState, deltaMs: number): ArenaStep {
  if (arena.gameOver || !arena.active) return noStep(arena);
  let next = arena.visual
    ? { ...arena, visual: { ...arena.visual, remainingMs: Math.max(0, arena.visual.remainingMs - deltaMs) } }
    : arena;
  if (next.visual && next.visual.remainingMs === 0) next = { ...next, visual: null };

  const active = next.active;
  if (!active) return noStep(next);
  const grounded = !canPlace(next.board, getPieceMatrix(active.piece, active.rotation), active.x, active.y + 1);
  let gravityElapsedMs = next.gravityElapsedMs + deltaMs;
  let lockElapsedMs = grounded ? next.lockElapsedMs + deltaMs : 0;
  let current = { ...active };
  const interval = getGravityIntervalMs(next.level);

  while (gravityElapsedMs >= interval) {
    gravityElapsedMs -= interval;
    if (!canPlace(next.board, getPieceMatrix(current.piece, current.rotation), current.x, current.y + 1)) {
      break;
    }
    current = { ...current, y: current.y + 1 };
    if (!canPlace(next.board, getPieceMatrix(current.piece, current.rotation), current.x, current.y + 1)) {
      lockElapsedMs = 0;
    }
  }

  next = { ...next, active: current, gravityElapsedMs, lockElapsedMs };
  if (!canPlace(next.board, getPieceMatrix(current.piece, current.rotation), current.x, current.y + 1) && lockElapsedMs >= LOCK_DELAY_MS) {
    return lockActivePiece(next);
  }
  return noStep(next);
}

export function applyArenaAction(arena: ArenaState, action: ArenaAction): ArenaStep {
  const active = arena.active;
  if (!active || arena.gameOver) return noStep(arena);

  if (action === "hold") return holdPiece(arena);
  if (action === "hardDrop") {
    let y = active.y;
    while (canPlace(arena.board, getPieceMatrix(active.piece, active.rotation), active.x, y + 1)) y += 1;
    const distance = y - active.y;
    // Keep the final rotation marker through a hard drop so a rotated T can
    // still resolve as a T-Spin when the selected pose is locked.
    const dropped = { ...arena, active: { ...active, y }, score: arena.score + distance * 2 };
    return lockActivePiece(dropped);
  }

  let candidate: ActivePiece | null = null;
  if (action === "left" || action === "right") {
    const x = active.x + (action === "left" ? -1 : 1);
    if (canPlace(arena.board, getPieceMatrix(active.piece, active.rotation), x, active.y)) {
      candidate = { ...active, x, lastActionWasRotation: false };
    }
  } else if (action === "softDrop") {
    if (canPlace(arena.board, getPieceMatrix(active.piece, active.rotation), active.x, active.y + 1)) {
      candidate = { ...active, y: active.y + 1 };
    }
  } else {
    const rotated = tryRotate(arena.board, active.piece, active, action === "rotateCW" ? 1 : -1);
    if (rotated) candidate = { ...active, ...rotated, lastActionWasRotation: true };
  }

  if (!candidate) return noStep(arena);
  const wasGrounded = !canPlace(arena.board, getPieceMatrix(active.piece, active.rotation), active.x, active.y + 1);
  const isGrounded = !canPlace(arena.board, getPieceMatrix(candidate.piece, candidate.rotation), candidate.x, candidate.y + 1);
  const canResetLock = arena.lockResets < MAX_LOCK_RESETS;
  const resetLock = wasGrounded && canResetLock;
  const lockElapsedMs = resetLock || (isGrounded && !wasGrounded) ? 0 : arena.lockElapsedMs;
  const lockResets = resetLock ? arena.lockResets + 1 : arena.lockResets;
  const score = arena.score + (action === "softDrop" ? 1 : 0);
  return noStep({ ...arena, active: candidate, lockElapsedMs, lockResets, score });
}

export function boardToCompactRows(board: TetrisBoard): string[] {
  return board.map((row) => row.map((cell) => cell ?? ".").join(""));
}

export function getDropY(board: TetrisBoard, active: ActivePiece): number {
  let y = active.y;
  while (canPlace(board, getPieceMatrix(active.piece, active.rotation), active.x, y + 1)) y += 1;
  return y;
}

function holdPiece(arena: ArenaState): ArenaStep {
  if (!arena.canHold || !arena.active) return noStep(arena);
  const current = arena.active.piece;
  let nextQueue = [...arena.queue];
  let replacement: PieceType;
  if (arena.hold) {
    replacement = arena.hold;
  } else {
    const drawn = drawPiece(nextQueue);
    replacement = drawn[0];
    nextQueue = drawn[1];
  }
  const active = getSpawnPiece(replacement, arena.active.id + 1);
  const gameOver = !canPlace(arena.board, getPieceMatrix(active.piece, 0), active.x, active.y);
  return {
    arena: {
      ...arena,
      active: gameOver ? null : active,
      queue: nextQueue,
      hold: current,
      canHold: false,
      gameOver,
      gameOverReason: gameOver ? "spawn-blocked" : null,
      gravityElapsedMs: 0,
      lockElapsedMs: 0,
      lockResets: 0,
      visual: null,
    },
    attackSent: 0,
    attackPower: 0,
    garbageCancelled: 0,
    damageReceived: 0,
    clearType: "none",
    locked: false,
    spawnedPieceId: gameOver ? null : active.id,
  };
}

function lockActivePiece(arena: ArenaState): ArenaStep {
  const active = arena.active;
  if (!active) return noStep(arena);
  const placed = placePiece(arena.board, active.piece, active);
  if (!placed) {
    return {
      arena: { ...arena, active: null, gameOver: true, gameOverReason: "lock-out" },
      attackSent: 0,
      attackPower: 0,
      garbageCancelled: 0,
      damageReceived: 0,
      clearType: "none",
      locked: true,
      spawnedPieceId: null,
    };
  }

  const combo = placed.linesCleared > 0 ? arena.combo + 1 : 0;
  const difficultClear = placed.linesCleared === 4 || (placed.tSpin !== "none" && placed.linesCleared > 0);
  const attackPower = getVersusAttack(placed.linesCleared, combo, {
    tSpin: placed.tSpin,
    backToBack: arena.backToBack,
    perfectClear: placed.perfectClear,
  });
  // Clearing a line removes one incoming row even when that clear creates no
  // outgoing attack. Attack power above the line count cancels extra rows.
  const cancelled = Math.min(arena.pendingGarbage, Math.max(placed.linesCleared, attackPower));
  const attackSent = Math.max(0, attackPower - cancelled);
  const incomingAfterCancel = arena.pendingGarbage - cancelled;
  const garbage = insertGarbageRows(placed.board, incomingAfterCancel);
  const score = arena.score + scoreForLines(placed.linesCleared, arena.level);
  const totalLines = arena.lines + placed.linesCleared;
  const level = Math.floor(totalLines / 10) + 1;
  const nextQueue = [...arena.queue];
  const [piece, rest] = drawPiece(nextQueue);
  const nextActive = getSpawnPiece(piece, active.id + 1);
  const spawnBlocked = !canPlace(garbage.board, getPieceMatrix(piece, 0), nextActive.x, nextActive.y);
  const gameOver = garbage.overflow || spawnBlocked;
  const gameOverReason: GameOverReason | null = garbage.overflow ? "garbage-overflow" : spawnBlocked ? "spawn-blocked" : null;
  const visual = placed.linesCleared > 0
    ? {
        lockedBoard: placed.lockedBoard,
        clearedRows: placed.clearedRows,
        settlementCells: getSettlementCells(placed.lockedBoard, placed.clearedRows),
        remainingMs: LINE_CLEAR_EFFECT_MS,
      }
    : null;

  return {
    arena: {
      ...arena,
      board: garbage.board,
      active: gameOver ? null : nextActive,
      queue: rest,
      canHold: true,
      score,
      lines: totalLines,
      level,
      pieces: arena.pieces + 1,
      combo,
      backToBack: difficultClear ? true : placed.linesCleared > 0 ? false : arena.backToBack,
      pendingGarbage: 0,
      gravityElapsedMs: 0,
      lockElapsedMs: 0,
      lockResets: 0,
      visual,
      gameOver,
      gameOverReason,
      lastLinesCleared: placed.linesCleared,
      lastAttack: attackSent,
      lastAttackPower: attackPower,
      lastGarbageCancelled: cancelled,
      lastClearType: placed.technique,
      lastTSpin: placed.tSpin,
    },
    attackSent,
    attackPower,
    garbageCancelled: cancelled,
    damageReceived: incomingAfterCancel,
    clearType: placed.technique,
    locked: true,
    spawnedPieceId: gameOver ? null : nextActive.id,
  };
}

function insertGarbageRows(board: TetrisBoard, count: number): { board: TetrisBoard; overflow: boolean } {
  if (count <= 0) return { board, overflow: false };
  const rowsToAdd = Math.min(count, TETRIS_HEIGHT);
  const overflow = board.slice(0, count).some((row) => row.some((cell) => cell !== null));
  const remaining = board.slice(rowsToAdd).map((row) => [...row]);
  const garbageRows = Array.from({ length: rowsToAdd }, () => {
    const hole = Math.floor(Math.random() * TETRIS_WIDTH);
    return Array.from({ length: TETRIS_WIDTH }, (_, x) => (x === hole ? null : "G")) as TetrisBoard[number];
  });
  return { board: [...remaining, ...garbageRows], overflow };
}

function drawPiece(queue: PieceType[]): [PieceType, PieceType[]] {
  // The queue is concatenated bag-by-bag. Refill only after the current bag
  // has been fully dealt, so a bag can never contain a duplicate piece.
  let available = [...queue];
  if (available.length === 0) available = makeSevenBag();
  const [piece, ...rest] = available;
  return [piece, rest];
}

function getSettlementCells(board: TetrisBoard, clearRows: number[]): SettlementCell[] {
  const cleared = new Set(clearRows);
  return board.flatMap((row, fromY) =>
    row.flatMap((piece, x) => {
      if (!piece || cleared.has(fromY)) return [];
      const drop = clearRows.filter((clearRow) => clearRow > fromY).length;
      return [{ key: `${fromY}:${x}`, piece, x, fromY, toY: fromY + drop }];
    }),
  );
}

function noStep(arena: ArenaState): ArenaStep {
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

function tryRotate(
  board: TetrisBoard,
  piece: PieceType,
  current: ActivePlacement,
  direction: RotationDirection,
): ActivePlacement | null {
  if (piece === "O") return { ...current };
  const from = normalizeRotation(piece, current.rotation);
  const to = (from + direction + 4) % 4;
  const kicks = (piece === "I" ? I_KICKS : JLSTZ_KICKS)[`${from}>${to}`] ?? [[0, 0]];
  for (const [offsetX, offsetY] of kicks) {
    const candidate = { x: current.x + offsetX, y: current.y + offsetY, rotation: to };
    if (canPlace(board, getPieceMatrix(piece, to), candidate.x, candidate.y)) return candidate;
  }
  return null;
}

function normalizeRotation(piece: PieceType, rotation: number): number {
  const count = ROTATIONS[piece].length;
  return ((rotation % count) + count) % count;
}

type SearchPlacement = ActivePlacement & { lastActionWasRotation: boolean };
type PathNode = SearchPlacement & { path: ArenaAction[] };

function placementStateKey(state: ActivePlacement) {
  return `${state.rotation}:${state.x}:${state.y}:${state.lastActionWasRotation ? "r" : "n"}`;
}

function canPlace(board: TetrisBoard, shape: number[][], x: number, y: number): boolean {
  for (let row = 0; row < shape.length; row += 1) {
    for (let column = 0; column < shape[row].length; column += 1) {
      if (!shape[row][column]) continue;
      const boardX = x + column;
      const boardY = y + row;
      if (boardX < 0 || boardX >= TETRIS_WIDTH || boardY >= TETRIS_HEIGHT) return false;
      if (boardY < 0) continue;
      if (board[boardY][boardX] !== null) return false;
    }
  }
  return true;
}

function lockBoard(
  board: TetrisBoard,
  piece: PieceType,
  rotation: number,
  x: number,
  y: number,
  lastActionWasRotation = false,
): LockedPlacement | null {
  const shape = getPieceMatrix(piece, rotation);
  if (!canPlace(board, shape, x, y)) return null;
  const updated = board.map((row) => [...row]);
  let visibleCells = 0;
  for (let row = 0; row < shape.length; row += 1) {
    for (let column = 0; column < shape[row].length; column += 1) {
      if (!shape[row][column]) continue;
      const boardY = y + row;
      const boardX = x + column;
      // The guideline playfield has a hidden buffer above the visible rows.
      // This app renders only the 20 visible rows, so clip a partially hidden
      // lock into the rendered board and treat a fully hidden lock as Lock Out.
      if (boardY < 0) continue;
      visibleCells += 1;
      updated[boardY][boardX] = piece;
    }
  }
  if (visibleCells === 0) return null;
  const clearedRows = updated.flatMap((row, index) => row.every((cell) => cell !== null) ? [index] : []);
  const garbageCellsCleared = clearedRows.reduce(
    (total, rowIndex) => total + updated[rowIndex].filter((cell) => cell === "G").length,
    0,
  );
  const remainingRows = updated.filter((row) => !row.every((cell) => cell !== null));
  const linesCleared = TETRIS_HEIGHT - remainingRows.length;
  const finalBoard = [
    ...Array.from({ length: linesCleared }, () => Array<TetrisCell | null>(TETRIS_WIDTH).fill(null)),
    ...remainingRows,
  ];
  const tSpin = getTSpinKind(updated, piece, rotation, x, y, lastActionWasRotation);
  const perfectClear = finalBoard.every((row) => row.every((cell) => cell === null));
  const technique = getClearTechnique(linesCleared, tSpin, perfectClear);
  return {
    board: finalBoard,
    lockedBoard: updated,
    clearedRows,
    linesCleared,
    garbageCellsCleared,
    tSpin,
    technique,
    perfectClear,
    ...getBoardMetrics(finalBoard),
  };
}

function getTSpinKind(
  board: TetrisBoard,
  piece: PieceType,
  rotation: number,
  x: number,
  y: number,
  lastActionWasRotation: boolean,
): TSpinKind {
  if (piece !== "T" || !lastActionWasRotation) return "none";
  const centerX = x + 1;
  const centerY = y + 1;
  const corners: [number, number][] = [
    [centerX - 1, centerY - 1],
    [centerX + 1, centerY - 1],
    [centerX + 1, centerY + 1],
    [centerX - 1, centerY + 1],
  ];
  const blocked = corners.map(([cornerX, cornerY]) =>
    cornerX < 0 || cornerX >= TETRIS_WIDTH || cornerY < 0 || cornerY >= TETRIS_HEIGHT
      ? true
      : board[cornerY][cornerX] !== null,
  );
  if (blocked.filter(Boolean).length < 3) return "none";
  const frontByRotation: Record<number, number[]> = {
    0: [0, 1],
    1: [1, 2],
    2: [2, 3],
    3: [3, 0],
  };
  const frontBlocked = (frontByRotation[normalizeRotation("T", rotation)] ?? [0, 1]).filter((index) => blocked[index]).length;
  return frontBlocked === 2 ? "full" : "mini";
}

function getClearTechnique(linesCleared: number, tSpin: TSpinKind, perfectClear: boolean): ClearTechnique {
  if (perfectClear && linesCleared > 0) return "perfect-clear";
  if (tSpin === "full") {
    return linesCleared === 1 ? "t-spin-single" : linesCleared === 2 ? "t-spin-double" : linesCleared === 3 ? "t-spin-triple" : "none";
  }
  if (tSpin === "mini") {
    return linesCleared === 1 ? "t-spin-mini-single" : linesCleared === 2 ? "t-spin-mini-double" : "none";
  }
  return linesCleared === 1 ? "single" : linesCleared === 2 ? "double" : linesCleared === 3 ? "triple" : linesCleared === 4 ? "tetris" : "none";
}

function getBoardMetrics(board: TetrisBoard) {
  const columnTopRows = Array.from({ length: TETRIS_WIDTH }, (_, column) => {
    const firstFilled = board.findIndex((row) => row[column] !== null);
    return firstFilled === -1 ? null : firstFilled;
  });
  const heights = columnTopRows.map((topRow) => topRow === null ? 0 : TETRIS_HEIGHT - topRow);
  const columnHoles = Array.from({ length: TETRIS_WIDTH }, () => 0);
  let holes = 0;
  for (let column = 0; column < TETRIS_WIDTH; column += 1) {
    let blockSeen = false;
    for (let row = 0; row < TETRIS_HEIGHT; row += 1) {
      if (board[row][column] !== null) blockSeen = true;
      else if (blockSeen) {
        holes += 1;
        columnHoles[column] += 1;
      }
    }
  }
  const centerColumns = [3, 4, 5, 6];
  const centerHeight = Math.max(...centerColumns.map((column) => heights[column]), 0);
  const centerFilledCells = centerColumns.reduce(
    (total, column) => total + board.reduce((count, row) => count + (row[column] === null ? 0 : 1), 0),
    0,
  );
  const centerHoles = centerColumns.reduce((total, column) => total + columnHoles[column], 0);
  const edgeHeight = Math.max(...[...heights.slice(0, 3), ...heights.slice(7)], 0);
  const centerExcess = centerHeight - edgeHeight;
  const centerStackRisk: CenterStackRisk =
    centerHeight >= 15 || centerExcess >= 5 || centerHoles >= 3
      ? "high"
      : centerHeight >= 10 || centerExcess >= 3 || centerHoles >= 1
        ? "medium"
        : "low";
  const leftHeight = Math.max(...heights.slice(0, 3), 0);
  const rightHeight = Math.max(...heights.slice(7), 0);
  const recommendedShift: BoardProfile["recommendedShift"] = centerStackRisk === "low"
    ? "none"
    : leftHeight + 1 < rightHeight
      ? "left"
      : rightHeight + 1 < leftHeight
        ? "right"
        : "split";
  return {
    holes,
    aggregateHeight: heights.reduce((total, height) => total + height, 0),
    bumpiness: heights.slice(1).reduce((total, height, index) => total + Math.abs(height - heights[index]), 0),
    maxHeight: Math.max(...heights),
    columnHeights: heights,
    columnTopRows,
    columnHoles,
    centerHeight,
    centerFilledCells,
    centerHoles,
    centerStackRisk,
    recommendedShift,
  };
}

function getBoardProfile(board: TetrisBoard): BoardProfile {
  const metrics = getBoardMetrics(board);
  return {
    columnHeights: metrics.columnHeights,
    columnTopRows: metrics.columnTopRows,
    columnHoles: metrics.columnHoles,
    centerHeight: metrics.centerHeight,
    centerFilledCells: metrics.centerFilledCells,
    centerHoles: metrics.centerHoles,
    centerStackRisk: metrics.centerStackRisk,
    recommendedShift: metrics.recommendedShift,
  };
}

function createRotations(baseShape: number[][]): number[][][] {
  const result = [baseShape.map((row) => [...row])];
  if (baseShape.length === 2) return result;
  let current = baseShape;
  for (let turn = 1; turn < 4; turn += 1) {
    current = rotateSquareClockwise(current);
    result.push(current);
  }
  return result;
}

function rotateSquareClockwise(shape: number[][]): number[][] {
  const size = shape.length;
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, column) => shape[size - column - 1][row]),
  );
}
