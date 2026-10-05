import {
  type AttackData,
  BODY_HALF_WIDTH,
  BODY_HEIGHT,
  type Box,
  HEAVY,
  HURTBOX,
  JUMP_ATTACK,
  LIGHT,
  PROJECTILE,
  RUSH,
} from "./character.ts";
import { Action, type Fighter, type Projectile, type State } from "./state.ts";

/** Box in stage coordinates (subpixels, y up). */
export interface WorldBox {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

export function attackData(action: Action): AttackData | undefined {
  switch (action) {
    case Action.Light:
      return LIGHT;
    case Action.Heavy:
      return HEAVY;
    case Action.JumpAttack:
      return JUMP_ATTACK;
    case Action.Rush:
      return RUSH;
    default:
      return undefined;
  }
}

export function isActiveFrame(fighter: Fighter, attack: AttackData): boolean {
  const first = attack.startup - 1;
  return fighter.actionFrame >= first && fighter.actionFrame < first + attack.active;
}

export function isInvulnerable(action: Action): boolean {
  return action === Action.AirFall || action === Action.Knockdown || action === Action.Ko;
}

export function toWorld(box: Box, x: number, y: number, facing: number): WorldBox {
  const left = facing === 1 ? x + box.x : x - box.x - box.w;
  return { left, right: left + box.w, bottom: y + box.y, top: y + box.y + box.h };
}

export function overlaps(a: WorldBox, b: WorldBox): boolean {
  return a.left < b.right && b.left < a.right && a.bottom < b.top && b.bottom < a.top;
}

export function pushbox(fighter: Fighter): WorldBox {
  return {
    left: fighter.x - BODY_HALF_WIDTH,
    right: fighter.x + BODY_HALF_WIDTH,
    bottom: fighter.y,
    top: fighter.y + BODY_HEIGHT,
  };
}

/** Where the fighter can be hit, or undefined while invulnerable. */
export function hurtbox(fighter: Fighter): WorldBox | undefined {
  if (isInvulnerable(fighter.action)) return undefined;
  return toWorld(HURTBOX, fighter.x, fighter.y, fighter.facing);
}

/** The attack's hitbox on its active frames, until it has connected. */
export function hitbox(fighter: Fighter): WorldBox | undefined {
  const attack = attackData(fighter.action);
  if (!attack || fighter.hasHit === 1 || !isActiveFrame(fighter, attack)) return undefined;
  return toWorld(attack.hitbox, fighter.x, fighter.y, fighter.facing);
}

export function projectileBox(projectile: Projectile): WorldBox | undefined {
  if (projectile.active === 0) return undefined;
  return toWorld(PROJECTILE.hitbox, projectile.x, projectile.y, Math.sign(projectile.vx));
}

export type BoxKind = "push" | "hurt" | "hit" | "projectile";

export interface CollisionBox {
  kind: BoxKind;
  player: 0 | 1;
  box: WorldBox;
}

/** Every box the simulation uses on this frame, for the debug view. */
export function collisionBoxes(state: State): CollisionBox[] {
  const boxes: CollisionBox[] = [];
  for (const player of [0, 1] as const) {
    const fighter = state.fighters[player];
    boxes.push({ kind: "push", player, box: pushbox(fighter) });
    const hurt = hurtbox(fighter);
    if (hurt) boxes.push({ kind: "hurt", player, box: hurt });
    const hit = hitbox(fighter);
    if (hit) boxes.push({ kind: "hit", player, box: hit });
    const projectile = projectileBox(state.projectiles[player]);
    if (projectile) boxes.push({ kind: "projectile", player, box: projectile });
  }
  return boxes;
}
