/**
 * The only character for now. Every value is an integer.
 * Distances are in subpixels (SUBPIXELS per pixel), durations in frames (60 per second).
 *
 * Frame data follows the usual fighting game convention: `startup` counts the frames up to and
 * including the first active frame, so a move with startup 4 can hit on the 4th frame.
 */

export const SUBPIXELS = 100;
const px = (pixels: number): number => pixels * SUBPIXELS;

/** Axis-aligned box relative to the fighter's feet. `x` grows toward the facing direction. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Timing of a move, in frames. */
export interface Timing {
  readonly startup: number;
  readonly active: number;
  readonly recovery: number;
}

export function totalFrames(timing: Timing): number {
  return timing.startup + timing.active + timing.recovery;
}

/** What happens to the defender on contact. */
export interface HitProperties {
  readonly damage: number;
  /** Frames the defender cannot act after being hit (ignored when `knockdown` is set). */
  readonly hitstun: number;
  readonly blockstun: number;
  /** Frames both fighters freeze on contact (only the defender for projectiles). */
  readonly hitstop: number;
  /** Initial slide speed given to the defender, in subpixels per frame. */
  readonly pushback: number;
  readonly knockdown: boolean;
  readonly hitbox: Box;
}

export interface AttackData extends Timing, HitProperties {}

export const STAGE_WIDTH = px(1200);
export const START_DISTANCE = px(400);
export const MAX_HEALTH = 1000;

export const BODY_HALF_WIDTH = px(35);
export const BODY_HEIGHT = px(180);
export const HURTBOX: Box = { x: px(-30), y: 0, w: px(60), h: px(170) };

export const WALK_FORWARD_SPEED = px(3);
export const WALK_BACK_SPEED = 250;
export const GROUND_FRICTION = px(1);

export const PREJUMP_FRAMES = 3;
export const LANDING_FRAMES = 3;
export const JUMP_VELOCITY = px(16);
export const JUMP_HORIZONTAL_SPEED = px(4);
export const GRAVITY = 80;

/** Launch applied to a fighter hit in the air or by a knockdown move. */
export const LAUNCH_VELOCITY = px(6);
export const LAUNCH_HORIZONTAL_SPEED = px(3);
export const KNOCKDOWN_FRAMES = 40;

export const LIGHT: AttackData = {
  startup: 4,
  active: 3,
  recovery: 7,
  damage: 40,
  hitstun: 15,
  blockstun: 11,
  hitstop: 8,
  pushback: px(6),
  knockdown: false,
  hitbox: { x: px(25), y: px(120), w: px(70), h: px(30) },
};

export const HEAVY: AttackData = {
  startup: 9,
  active: 3,
  recovery: 18,
  damage: 90,
  hitstun: 21,
  blockstun: 13,
  hitstop: 12,
  pushback: px(9),
  knockdown: false,
  hitbox: { x: px(30), y: px(60), w: px(100), h: px(50) },
};

export const JUMP_ATTACK: AttackData = {
  startup: 6,
  active: 10,
  recovery: 4,
  damage: 70,
  hitstun: 18,
  blockstun: 12,
  hitstop: 10,
  pushback: px(5),
  knockdown: false,
  hitbox: { x: px(10), y: px(-10), w: px(70), h: px(70) },
};

/** Dash attack (QCB + attack): travels fast during its active frames, knocks down, very unsafe. */
export const RUSH: AttackData = {
  startup: 10,
  active: 14,
  recovery: 22,
  damage: 80,
  hitstun: 0,
  blockstun: 12,
  hitstop: 12,
  pushback: px(8),
  knockdown: true,
  hitbox: { x: px(20), y: px(60), w: px(80), h: px(80) },
};
export const RUSH_SPEED = px(11);

/** Projectile throw (QCF + attack). The projectile spawns on the last startup frame. */
export const PROJECTILE_THROW: Timing = { startup: 13, active: 1, recovery: 32 };

export const PROJECTILE: HitProperties = {
  damage: 60,
  hitstun: 18,
  blockstun: 14,
  hitstop: 8,
  pushback: px(5),
  knockdown: false,
  hitbox: { x: px(-20), y: px(110), w: px(40), h: px(30) },
};
export const PROJECTILE_SPEED = px(7);
export const PROJECTILE_SPAWN_OFFSET = px(60);
/** Projectiles are removed once this far outside the stage. */
export const PROJECTILE_MARGIN = px(100);
