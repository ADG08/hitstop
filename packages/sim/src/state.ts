import { MAX_HEALTH, STAGE_WIDTH, START_DISTANCE } from "./character.ts";
import { INPUT_HISTORY } from "./input.ts";
import { ROUND_FRAMES } from "./rules.ts";

export const Action = {
  Idle: 0,
  WalkForward: 1,
  WalkBack: 2,
  Prejump: 3,
  Airborne: 4,
  Landing: 5,
  Light: 6,
  Heavy: 7,
  JumpAttack: 8,
  ProjectileThrow: 9,
  Rush: 10,
  Hitstun: 11,
  Blockstun: 12,
  AirFall: 13,
  Knockdown: 14,
  Ko: 15,
} as const;
export type Action = (typeof Action)[keyof typeof Action];
export const ACTION_COUNT = 16;

export const Result = {
  Ongoing: 0,
  Player1Wins: 1,
  Player2Wins: 2,
  Draw: 3,
} as const;
export type Result = (typeof Result)[keyof typeof Result];

export const Phase = {
  /** Players are placed, inputs are ignored. */
  Intro: 0,
  Fight: 1,
  /** After a KO or a time out: no more hits, inputs ignored. */
  RoundOver: 2,
  /** Final state: nothing changes anymore except the frame counter. */
  MatchOver: 3,
} as const;
export type Phase = (typeof Phase)[keyof typeof Phase];

/** Every field is an integer so that the state is exactly reproducible and hashable. */
export interface Fighter {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 1 = facing right, -1 = facing left. */
  facing: number;
  health: number;
  action: Action;
  /** Index of the current frame within `action`, 0 on the frame the action starts. */
  actionFrame: number;
  /** Duration of the current hitstun, blockstun or knockdown. */
  stun: number;
  /** Remaining freeze frames after a hit or a block. */
  hitstop: number;
  /** 1 once the current attack has connected, so it hits at most once. */
  hasHit: number;
  /** 1 once the air attack has been used during the current jump. */
  airAttackUsed: number;
  /** Horizontal direction of the pending jump: -1, 0 or 1. */
  jumpDirection: number;
}

export interface Projectile {
  active: number;
  x: number;
  y: number;
  vx: number;
}

export interface State {
  frame: number;
  result: Result;
  phase: Phase;
  /** Frames spent in the current phase. */
  phaseFrame: number;
  /** Current round, starting at 1. */
  round: number;
  /** Frames left in the current round. */
  timer: number;
  /** Rounds won by each player. */
  wins: [number, number];
  fighters: [Fighter, Fighter];
  /** At most one projectile per player; slot i belongs to player i. */
  projectiles: [Projectile, Projectile];
  /** Ring buffers of past inputs, one per player. */
  inputHistory: [number[], number[]];
  /** Index of the current frame's input in each ring buffer. */
  historyHead: number;
}

function createFighter(x: number, facing: number): Fighter {
  return {
    x,
    y: 0,
    vx: 0,
    vy: 0,
    facing,
    health: MAX_HEALTH,
    action: Action.Idle,
    actionFrame: 0,
    stun: 0,
    hitstop: 0,
    hasHit: 0,
    airAttackUsed: 0,
    jumpDirection: 0,
  };
}

function createProjectile(): Projectile {
  return { active: 0, x: 0, y: 0, vx: 0 };
}

export type RoundStart = Pick<
  State,
  "timer" | "fighters" | "projectiles" | "inputHistory" | "historyHead"
>;

/** Everything that is reset at the start of each round: positions, health, timer, inputs. */
export function createRoundStart(): RoundStart {
  const center = STAGE_WIDTH / 2;
  return {
    timer: ROUND_FRAMES,
    fighters: [
      createFighter(center - START_DISTANCE / 2, 1),
      createFighter(center + START_DISTANCE / 2, -1),
    ],
    projectiles: [createProjectile(), createProjectile()],
    inputHistory: [new Array(INPUT_HISTORY).fill(0), new Array(INPUT_HISTORY).fill(0)],
    historyHead: 0,
  };
}

export function createInitialState(): State {
  return {
    frame: 0,
    result: Result.Ongoing,
    phase: Phase.Intro,
    phaseFrame: 0,
    round: 1,
    wins: [0, 0],
    ...createRoundStart(),
  };
}

export function cloneState(state: State): State {
  return {
    frame: state.frame,
    result: state.result,
    phase: state.phase,
    phaseFrame: state.phaseFrame,
    round: state.round,
    timer: state.timer,
    wins: [state.wins[0], state.wins[1]],
    fighters: [{ ...state.fighters[0] }, { ...state.fighters[1] }],
    projectiles: [{ ...state.projectiles[0] }, { ...state.projectiles[1] }],
    inputHistory: [[...state.inputHistory[0]], [...state.inputHistory[1]]],
    historyHead: state.historyHead,
  };
}

// Serialization order. Adding a field to Fighter or Projectile without listing it here makes the
// round-trip test fail, so the hash always covers the whole state.
const FIGHTER_FIELDS = [
  "x",
  "y",
  "vx",
  "vy",
  "facing",
  "health",
  "action",
  "actionFrame",
  "stun",
  "hitstop",
  "hasHit",
  "airAttackUsed",
  "jumpDirection",
] as const satisfies readonly (keyof Fighter)[];
const PROJECTILE_FIELDS = [
  "active",
  "x",
  "y",
  "vx",
] as const satisfies readonly (keyof Projectile)[];

const HEADER_LENGTH = 9;

export const SERIALIZED_LENGTH =
  HEADER_LENGTH + 2 * FIGHTER_FIELDS.length + 2 * PROJECTILE_FIELDS.length + 2 * INPUT_HISTORY;

/** Flat, fixed-order encoding of the state. Used for hashing, snapshots (rollback) and replays. */
export function serialize(state: State): Int32Array {
  const out = new Int32Array(SERIALIZED_LENGTH);
  let i = 0;
  out[i++] = state.frame;
  out[i++] = state.result;
  out[i++] = state.historyHead;
  out[i++] = state.phase;
  out[i++] = state.phaseFrame;
  out[i++] = state.round;
  out[i++] = state.timer;
  out[i++] = state.wins[0];
  out[i++] = state.wins[1];
  for (const fighter of state.fighters) {
    for (const field of FIGHTER_FIELDS) out[i++] = fighter[field];
  }
  for (const projectile of state.projectiles) {
    for (const field of PROJECTILE_FIELDS) out[i++] = projectile[field];
  }
  for (const history of state.inputHistory) {
    for (const input of history) out[i++] = input;
  }
  return out;
}

export function deserialize(data: Int32Array): State {
  if (data.length !== SERIALIZED_LENGTH) {
    throw new Error(`Expected ${SERIALIZED_LENGTH} values, got ${data.length}`);
  }
  let i = 0;
  const next = (): number => data[i++] ?? 0;
  const frame = next();
  const result = next() as Result;
  const historyHead = next();
  const phase = next() as Phase;
  const phaseFrame = next();
  const round = next();
  const timer = next();
  const wins: [number, number] = [next(), next()];
  const readFighter = (): Fighter => {
    const fighter = {} as Record<(typeof FIGHTER_FIELDS)[number], number>;
    for (const field of FIGHTER_FIELDS) fighter[field] = next();
    return fighter as Fighter;
  };
  const readProjectile = (): Projectile => {
    const projectile = {} as Record<(typeof PROJECTILE_FIELDS)[number], number>;
    for (const field of PROJECTILE_FIELDS) projectile[field] = next();
    return projectile;
  };
  const readHistory = (): number[] => Array.from({ length: INPUT_HISTORY }, next);
  const fighters: [Fighter, Fighter] = [readFighter(), readFighter()];
  const projectiles: [Projectile, Projectile] = [readProjectile(), readProjectile()];
  const inputHistory: [number[], number[]] = [readHistory(), readHistory()];
  return {
    frame,
    result,
    phase,
    phaseFrame,
    round,
    timer,
    wins,
    fighters,
    projectiles,
    inputHistory,
    historyHead,
  };
}

/** 32-bit FNV-1a hash of the serialized state. Equal states always give equal hashes. */
export function hashState(state: State): number {
  const words = serialize(state);
  let hash = 0x811c9dc5;
  for (const word of words) {
    for (let shift = 0; shift < 32; shift += 8) {
      hash ^= (word >>> shift) & 0xff;
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return hash >>> 0;
}
