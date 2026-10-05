import {
  attackData,
  hitbox,
  hurtbox,
  isActiveFrame,
  overlaps,
  projectileBox,
  pushbox,
} from "./boxes.ts";
import {
  BODY_HALF_WIDTH,
  GRAVITY,
  GROUND_FRICTION,
  type HitProperties,
  JUMP_HORIZONTAL_SPEED,
  JUMP_VELOCITY,
  KNOCKDOWN_FRAMES,
  LANDING_FRAMES,
  LAUNCH_HORIZONTAL_SPEED,
  LAUNCH_VELOCITY,
  PREJUMP_FRAMES,
  PROJECTILE,
  PROJECTILE_MARGIN,
  PROJECTILE_SPAWN_OFFSET,
  PROJECTILE_SPEED,
  PROJECTILE_THROW,
  RUSH,
  RUSH_SPEED,
  STAGE_WIDTH,
  totalFrames,
  WALK_BACK_SPEED,
  WALK_FORWARD_SPEED,
} from "./character.ts";
import {
  Button,
  backBit,
  type FrameInput,
  forwardBit,
  hasQuarterCircle,
  horizontalDirection,
  INPUT_HISTORY,
  type Input,
  pressedAttacks,
} from "./input.ts";
import { ROUND_INTRO_FRAMES, ROUND_OVER_FRAMES, ROUNDS_TO_WIN } from "./rules.ts";
import {
  Action,
  cloneState,
  createRoundStart,
  type Fighter,
  Phase,
  type Projectile,
  Result,
  type State,
} from "./state.ts";

type PlayerIndex = 0 | 1;
const PLAYERS: readonly PlayerIndex[] = [0, 1];

/** Advances the simulation by one frame. Pure: the given state is not modified. */
export function step(previous: State, inputs: FrameInput): State {
  const state = cloneState(previous);
  state.frame++;
  if (state.phase === Phase.MatchOver) return state;

  state.historyHead = (state.historyHead + 1) % INPUT_HISTORY;
  for (const p of PLAYERS) state.inputHistory[p][state.historyHead] = inputs[p];

  const fighting = state.phase === Phase.Fight;
  for (const p of PLAYERS) moveProjectile(state.projectiles[p]);
  for (const p of PLAYERS) updateFighter(state, p, fighting);
  separateFighters(state.fighters);
  for (const p of PLAYERS) updateFacing(state.fighters[p], state.fighters[otherPlayer(p)]);
  if (fighting) resolveHits(state);
  advancePhase(state);
  return state;
}

function otherPlayer(p: PlayerIndex): PlayerIndex {
  return p === 0 ? 1 : 0;
}

function historyReader(state: State, p: PlayerIndex): (age: number) => Input {
  const history = state.inputHistory[p];
  return (age) => history[(state.historyHead - age + INPUT_HISTORY) % INPUT_HISTORY] ?? 0;
}

// ---------------------------------------------------------------------------------------------
// Fighter state machine
// ---------------------------------------------------------------------------------------------

/** Total length of an action, or 0 when it only ends through an event (landing, input...). */
function actionDuration(fighter: Fighter): number {
  const attack = attackData(fighter.action);
  if (attack) return totalFrames(attack);
  switch (fighter.action) {
    case Action.ProjectileThrow:
      return totalFrames(PROJECTILE_THROW);
    case Action.Prejump:
      return PREJUMP_FRAMES;
    case Action.Landing:
      return LANDING_FRAMES;
    case Action.Hitstun:
    case Action.Blockstun:
    case Action.Knockdown:
      return fighter.stun;
    default:
      return 0;
  }
}

function isGroundedNeutral(action: Action): boolean {
  return action === Action.Idle || action === Action.WalkForward || action === Action.WalkBack;
}

function setAction(fighter: Fighter, action: Action): void {
  fighter.action = action;
  fighter.actionFrame = 0;
}

/** `canAct` is false outside of the fight phase: the fighter finishes its action, then idles. */
function updateFighter(state: State, p: PlayerIndex, canAct: boolean): void {
  const fighter = state.fighters[p];
  if (fighter.hitstop > 0) {
    fighter.hitstop--;
    return;
  }

  if (!isGroundedNeutral(fighter.action)) {
    fighter.actionFrame++;
    const duration = actionDuration(fighter);
    if (duration > 0 && fighter.actionFrame >= duration) endAction(fighter);
  }

  const history = historyReader(state, p);
  if (!canAct) {
    if (isGroundedNeutral(fighter.action)) {
      if (fighter.action !== Action.Idle) setAction(fighter, Action.Idle);
      fighter.vx = 0;
    }
  } else if (isGroundedNeutral(fighter.action)) {
    startGroundAction(state, p, history);
  } else if (fighter.action === Action.Airborne) {
    startAirAction(fighter, history);
  }

  if (
    fighter.action === Action.ProjectileThrow &&
    fighter.actionFrame === PROJECTILE_THROW.startup - 1
  ) {
    spawnProjectile(state.projectiles[p], fighter);
  }

  applyPhysics(fighter);
}

function endAction(fighter: Fighter): void {
  switch (fighter.action) {
    case Action.Prejump:
      setAction(fighter, Action.Airborne);
      fighter.vy = JUMP_VELOCITY;
      fighter.vx = fighter.jumpDirection * JUMP_HORIZONTAL_SPEED;
      fighter.airAttackUsed = 0;
      break;
    case Action.JumpAttack:
      setAction(fighter, Action.Airborne);
      break;
    default:
      setAction(fighter, Action.Idle);
      fighter.vx = 0;
  }
}

function startGroundAction(state: State, p: PlayerIndex, history: (age: number) => Input): void {
  const fighter = state.fighters[p];
  const input = history(0);

  if (pressedAttacks(input, history(1)) !== 0) {
    fighter.hasHit = 0;
    if (
      hasQuarterCircle(history, forwardBit(fighter.facing)) &&
      state.projectiles[p].active === 0
    ) {
      setAction(fighter, Action.ProjectileThrow);
    } else if (hasQuarterCircle(history, backBit(fighter.facing))) {
      setAction(fighter, Action.Rush);
    } else {
      setAction(fighter, (input & Button.Light) !== 0 ? Action.Light : Action.Heavy);
    }
    fighter.vx = 0;
    return;
  }

  if ((input & Button.Up) !== 0) {
    setAction(fighter, Action.Prejump);
    fighter.jumpDirection = horizontalDirection(input);
    fighter.vx = 0;
    return;
  }

  const held = horizontalDirection(input);
  const next =
    held === fighter.facing
      ? Action.WalkForward
      : held === -fighter.facing
        ? Action.WalkBack
        : Action.Idle;
  if (next !== fighter.action) setAction(fighter, next);
  fighter.vx =
    next === Action.WalkForward
      ? fighter.facing * WALK_FORWARD_SPEED
      : next === Action.WalkBack
        ? -fighter.facing * WALK_BACK_SPEED
        : 0;
}

function startAirAction(fighter: Fighter, history: (age: number) => Input): void {
  if (fighter.airAttackUsed === 0 && pressedAttacks(history(0), history(1)) !== 0) {
    setAction(fighter, Action.JumpAttack);
    fighter.airAttackUsed = 1;
    fighter.hasHit = 0;
  }
}

function applyPhysics(fighter: Fighter): void {
  if (fighter.action === Action.Rush) {
    const moving = fighter.hasHit === 0 && isActiveFrame(fighter, RUSH);
    fighter.vx = moving ? fighter.facing * RUSH_SPEED : applyFriction(fighter.vx);
  } else if (
    fighter.action === Action.Hitstun ||
    fighter.action === Action.Blockstun ||
    fighter.action === Action.Knockdown ||
    fighter.action === Action.Ko
  ) {
    if (fighter.y === 0) fighter.vx = applyFriction(fighter.vx);
  }

  fighter.x += fighter.vx;
  if (fighter.y > 0 || fighter.vy > 0) {
    fighter.y += fighter.vy;
    fighter.vy -= GRAVITY;
    if (fighter.y <= 0) land(fighter);
  }
}

function applyFriction(vx: number): number {
  if (vx > 0) return Math.max(0, vx - GROUND_FRICTION);
  if (vx < 0) return Math.min(0, vx + GROUND_FRICTION);
  return 0;
}

function land(fighter: Fighter): void {
  fighter.y = 0;
  fighter.vy = 0;
  fighter.vx = 0;
  if (fighter.action === Action.AirFall) {
    setAction(fighter, Action.Knockdown);
    fighter.stun = KNOCKDOWN_FRAMES;
  } else if (fighter.action !== Action.Ko) {
    setAction(fighter, Action.Landing);
  }
}

function updateFacing(fighter: Fighter, opponent: Fighter): void {
  const canTurn = isGroundedNeutral(fighter.action) || fighter.action === Action.Landing;
  if (!canTurn || fighter.x === opponent.x) return;
  fighter.facing = opponent.x > fighter.x ? 1 : -1;
}

// ---------------------------------------------------------------------------------------------
// Projectiles
// ---------------------------------------------------------------------------------------------

function spawnProjectile(projectile: Projectile, owner: Fighter): void {
  projectile.active = 1;
  projectile.x = owner.x + owner.facing * PROJECTILE_SPAWN_OFFSET;
  projectile.y = owner.y;
  projectile.vx = owner.facing * PROJECTILE_SPEED;
}

function moveProjectile(projectile: Projectile): void {
  if (projectile.active === 0) return;
  projectile.x += projectile.vx;
  if (projectile.x < -PROJECTILE_MARGIN || projectile.x > STAGE_WIDTH + PROJECTILE_MARGIN) {
    deactivate(projectile);
  }
}

/** Inactive projectiles are fully zeroed, so the state holds no stale positions. */
function deactivate(projectile: Projectile): void {
  projectile.active = 0;
  projectile.x = 0;
  projectile.y = 0;
  projectile.vx = 0;
}

// ---------------------------------------------------------------------------------------------
// Pushboxes and stage bounds
// ---------------------------------------------------------------------------------------------

function clampToStage(fighter: Fighter): void {
  fighter.x = Math.min(Math.max(fighter.x, BODY_HALF_WIDTH), STAGE_WIDTH - BODY_HALF_WIDTH);
}

/**
 * Pushes overlapping fighters apart. Each one moves by half the overlap, rounded up, so the
 * result does not depend on player order or on which side of the stage they stand.
 */
function separateFighters(fighters: [Fighter, Fighter]): void {
  const [a, b] = fighters;
  clampToStage(a);
  clampToStage(b);
  if (!overlaps(pushbox(a), pushbox(b))) return;

  const overlap = 2 * BODY_HALF_WIDTH - Math.abs(a.x - b.x);

  let direction: number; // side of `a` relative to `b`
  if (a.x !== b.x) direction = a.x < b.x ? -1 : 1;
  else if (a.facing !== b.facing) direction = -a.facing;
  else return;

  const half = (overlap + 1) >> 1;
  a.x += direction * half;
  b.x -= direction * half;
  clampToStage(a);
  clampToStage(b);

  // Against a wall, the fighter that is not cornered takes the remaining push.
  const remaining = 2 * BODY_HALF_WIDTH - Math.abs(a.x - b.x);
  if (remaining > 0) {
    const aCornered = a.x === BODY_HALF_WIDTH || a.x === STAGE_WIDTH - BODY_HALF_WIDTH;
    const bCornered = b.x === BODY_HALF_WIDTH || b.x === STAGE_WIDTH - BODY_HALF_WIDTH;
    if (aCornered && !bCornered) b.x -= direction * remaining;
    else if (bCornered && !aCornered) a.x += direction * remaining;
    clampToStage(a);
    clampToStage(b);
  }
}

// ---------------------------------------------------------------------------------------------
// Hits
// ---------------------------------------------------------------------------------------------

interface Hit {
  attack: HitProperties;
  /** Direction the hit travels in: 1 = toward the right. */
  direction: number;
  projectile: boolean;
}

/**
 * Hits are detected for both players on the same snapshot, then applied together, so trades are
 * possible and neither player is favored by processing order.
 */
function resolveHits(state: State): void {
  const [p0, p1] = state.projectiles;
  const box0 = projectileBox(p0);
  const box1 = projectileBox(p1);
  if (box0 && box1 && overlaps(box0, box1)) {
    deactivate(p0);
    deactivate(p1);
  }

  const hits: [Hit | undefined, Hit | undefined] = [findHit(state, 1), findHit(state, 0)];
  const blocked = [
    hits[0] !== undefined && isBlocking(state, 0, hits[0].direction),
    hits[1] !== undefined && isBlocking(state, 1, hits[1].direction),
  ];

  // Effects on attackers first, then on defenders, identically for both players.
  for (const defender of PLAYERS) {
    const hit = hits[defender];
    if (!hit) continue;
    const attacker = otherPlayer(defender);
    if (hit.projectile) {
      deactivate(state.projectiles[attacker]);
    } else {
      const fighter = state.fighters[attacker];
      fighter.hasHit = 1;
      fighter.hitstop = Math.max(fighter.hitstop, hit.attack.hitstop);
    }
  }
  for (const defender of PLAYERS) {
    const hit = hits[defender];
    if (hit) applyHit(state.fighters[defender], hit, blocked[defender] === true);
  }
}

/** The hit that `attacker` lands on the other player this frame, if any. Melee wins over projectile. */
function findHit(state: State, attacker: PlayerIndex): Hit | undefined {
  const fighter = state.fighters[attacker];
  const hurt = hurtbox(state.fighters[otherPlayer(attacker)]);
  if (!hurt) return undefined;

  const attack = attackData(fighter.action);
  const hit = hitbox(fighter);
  if (attack && hit && overlaps(hit, hurt)) {
    return { attack, direction: fighter.facing, projectile: false };
  }

  const projectile = state.projectiles[attacker];
  const box = projectileBox(projectile);
  if (box && overlaps(box, hurt)) {
    return { attack: PROJECTILE, direction: Math.sign(projectile.vx), projectile: true };
  }
  return undefined;
}

/** Blocking means holding away from the attack (in the direction it travels) on the ground. */
function isBlocking(state: State, defender: PlayerIndex, direction: number): boolean {
  const fighter = state.fighters[defender];
  const canBlock = isGroundedNeutral(fighter.action) || fighter.action === Action.Blockstun;
  if (!canBlock || fighter.y > 0) return false;
  return horizontalDirection(historyReader(state, defender)(0)) === direction;
}

function applyHit(fighter: Fighter, hit: Hit, blocked: boolean): void {
  const { attack, direction } = hit;
  fighter.hitstop = Math.max(fighter.hitstop, attack.hitstop);

  if (blocked) {
    setAction(fighter, Action.Blockstun);
    fighter.stun = attack.blockstun;
    fighter.vx = direction * attack.pushback;
    return;
  }

  fighter.health = Math.max(0, fighter.health - attack.damage);
  if (fighter.y > 0 || attack.knockdown) {
    setAction(fighter, Action.AirFall);
    fighter.vy = LAUNCH_VELOCITY;
    fighter.vx = direction * LAUNCH_HORIZONTAL_SPEED;
  } else {
    setAction(fighter, Action.Hitstun);
    fighter.stun = attack.hitstun;
    fighter.vx = direction * attack.pushback;
  }
}

// ---------------------------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------------------------

function enterPhase(state: State, phase: Phase): void {
  state.phase = phase;
  state.phaseFrame = 0;
}

function advancePhase(state: State): void {
  state.phaseFrame++;
  switch (state.phase) {
    case Phase.Intro:
      if (state.phaseFrame >= ROUND_INTRO_FRAMES) enterPhase(state, Phase.Fight);
      break;
    case Phase.Fight:
      state.timer--;
      endRoundIfOver(state);
      break;
    case Phase.RoundOver:
      if (state.phaseFrame >= ROUND_OVER_FRAMES) finishRound(state);
      break;
  }
}

/**
 * A round ends on KO or when the timer runs out. A double KO or a time out with equal health
 * gives the round to both players, so a match always ends.
 */
function endRoundIfOver(state: State): void {
  const [f0, f1] = state.fighters;
  const ko0 = f0.health === 0;
  const ko1 = f1.health === 0;
  if (ko0 || ko1) {
    if (ko0) setAction(f0, Action.Ko);
    if (ko1) setAction(f1, Action.Ko);
    if (ko1) state.wins[0]++;
    if (ko0) state.wins[1]++;
    enterPhase(state, Phase.RoundOver);
  } else if (state.timer === 0) {
    if (f0.health >= f1.health) state.wins[0]++;
    if (f1.health >= f0.health) state.wins[1]++;
    enterPhase(state, Phase.RoundOver);
  }
}

function finishRound(state: State): void {
  const won0 = state.wins[0] >= ROUNDS_TO_WIN;
  const won1 = state.wins[1] >= ROUNDS_TO_WIN;
  if (won0 || won1) {
    state.result = won0 && won1 ? Result.Draw : won0 ? Result.Player1Wins : Result.Player2Wins;
    enterPhase(state, Phase.MatchOver);
    return;
  }
  state.round++;
  Object.assign(state, createRoundStart());
  enterPhase(state, Phase.Intro);
}
