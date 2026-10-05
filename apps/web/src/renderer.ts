import {
  Action,
  attackData,
  BODY_HALF_WIDTH,
  BODY_HEIGHT,
  type BoxKind,
  collisionBoxes,
  isActiveFrame,
  MAX_HEALTH,
  PROJECTILE,
  type Projectile,
  ROUNDS_TO_WIN,
  STAGE_WIDTH,
  type State,
  SUBPIXELS,
  type WorldBox,
} from "@hitstop/sim";
import { Container, Graphics, Text } from "pixi.js";
import { announcement, timerSeconds } from "./hud.ts";

export const SCREEN_WIDTH = 1280;
export const SCREEN_HEIGHT = 720;
const MARGIN_X = (SCREEN_WIDTH - STAGE_WIDTH / SUBPIXELS) / 2;
const GROUND_Y = 640;

const PLAYER_COLORS = [0x4ea1ff, 0xff6b4e] as const;
const BOX_COLORS: Record<BoxKind, number> = {
  push: 0xffffff,
  hurt: 0x3ddc84,
  hit: 0xff3355,
  projectile: 0xffa500,
};
const BAR_WIDTH = 500;
const BAR_HEIGHT = 24;
const BAR_Y = 34;

const toPixels = (subpixels: number) => subpixels / SUBPIXELS;
const screenX = (x: number) => MARGIN_X + toPixels(x);
const screenY = (y: number) => GROUND_Y - toPixels(y);

/** A 1×1 filled square, positioned and scaled every frame instead of being redrawn. */
function unitRect(color = 0xffffff): Graphics {
  return new Graphics().rect(0, 0, 1, 1).fill(color);
}

function setText(text: Text, value: string): void {
  if (text.text !== value) text.text = value;
}

class FighterView {
  readonly root = new Container();
  private readonly body = new Container();
  private readonly limb = unitRect(0xffffff);

  constructor(color: number) {
    const halfWidth = toPixels(BODY_HALF_WIDTH);
    const height = toPixels(BODY_HEIGHT);
    const shape = new Graphics()
      .rect(-halfWidth, -height, 2 * halfWidth, height)
      .fill(color)
      .rect(halfWidth - 24, -height + 14, 14, 10)
      .fill(0xffffff);
    this.body.addChild(shape);
    this.limb.tint = color;
    this.root.addChild(this.body, this.limb);
  }

  update(state: State, player: 0 | 1): void {
    const fighter = state.fighters[player];
    const shake =
      fighter.hitstop > 0 && fighter.action === Action.Hitstun ? (state.frame % 2) * 4 - 2 : 0;
    this.root.position.set(screenX(fighter.x) + shake, screenY(fighter.y));
    this.root.scale.x = fighter.facing;

    const lying =
      (fighter.action === Action.Knockdown || fighter.action === Action.Ko) && fighter.y === 0;
    const crouched = fighter.action === Action.Prejump || fighter.action === Action.Landing;
    this.body.scale.y = lying ? 0.25 : crouched ? 0.88 : 1;
    this.body.rotation = fighter.action === Action.AirFall ? -0.5 : 0;
    this.body.alpha = fighter.action === Action.Knockdown ? 0.7 : 1;
    this.body.tint =
      fighter.action === Action.Hitstun
        ? 0xff9999
        : fighter.action === Action.Blockstun
          ? 0x99bbff
          : 0xffffff;

    // The attacking limb covers the hitbox: faint before and after the active frames.
    const attack = attackData(fighter.action);
    this.limb.visible = attack !== undefined;
    if (attack) {
      const box = attack.hitbox;
      this.limb.position.set(toPixels(box.x), -toPixels(box.y + box.h));
      this.limb.scale.set(toPixels(box.w), toPixels(box.h));
      this.limb.alpha = isActiveFrame(fighter, attack) ? 1 : 0.35;
    }
  }
}

class HealthBar {
  readonly root = new Container();
  private readonly fill = unitRect(0xf2c14e);
  private readonly pips: Graphics[] = [];
  private readonly side: "left" | "right";

  constructor(side: "left" | "right", label: string) {
    this.side = side;
    const x = side === "left" ? MARGIN_X : SCREEN_WIDTH - MARGIN_X - BAR_WIDTH;
    const background = unitRect(0x5a1f1f);
    background.position.set(x, BAR_Y);
    background.scale.set(BAR_WIDTH, BAR_HEIGHT);
    this.fill.position.y = BAR_Y;
    this.fill.scale.y = BAR_HEIGHT;
    const name = new Text({
      text: label,
      style: { fill: 0xffffff, fontSize: 18, fontWeight: "bold" },
    });
    name.position.set(side === "left" ? x : x + BAR_WIDTH - name.width, BAR_Y - 24);
    this.root.addChild(background, this.fill, name);
    for (let i = 0; i < ROUNDS_TO_WIN; i++) {
      const pip = new Graphics().circle(0, 0, 7).fill(0xf2c14e);
      const offset = 10 + i * 22;
      pip.position.set(
        side === "left" ? x + offset : x + BAR_WIDTH - offset,
        BAR_Y + BAR_HEIGHT + 16,
      );
      this.pips.push(pip);
      this.root.addChild(pip);
    }
  }

  update(health: number, wins: number): void {
    const width = (BAR_WIDTH * health) / MAX_HEALTH;
    this.fill.scale.x = width;
    this.fill.position.x = this.side === "left" ? MARGIN_X : SCREEN_WIDTH - MARGIN_X - width;
    this.pips.forEach((pip, i) => {
      pip.alpha = i < wins ? 1 : 0.2;
    });
  }
}

/** Draws a State. Holds no game logic: everything shown is read from the state. */
export class Renderer {
  readonly root = new Container();
  private readonly fighters = [
    new FighterView(PLAYER_COLORS[0]),
    new FighterView(PLAYER_COLORS[1]),
  ];
  private readonly projectiles = [this.createProjectileView(0), this.createProjectileView(1)];
  /** Pool for the debug view: at most 4 boxes per player (push, hurt, hit, projectile). */
  private readonly boxes: Graphics[] = Array.from({ length: 8 }, () => unitRect());
  private readonly bars = [new HealthBar("left", "J1"), new HealthBar("right", "J2")];
  private readonly timer = new Text({
    text: "",
    style: { fill: 0xffffff, fontSize: 40, fontWeight: "bold" },
  });
  private readonly title = new Text({
    text: "",
    style: {
      fill: 0xffffff,
      fontSize: 72,
      fontWeight: "bold",
      stroke: { color: 0x000000, width: 6, join: "round" },
    },
  });
  private readonly subtitle = new Text({ text: "", style: { fill: 0xffffff, fontSize: 28 } });
  /** Frame number of the last state drawn, to check the display never lags the simulation. */
  drawnFrame = -1;

  constructor() {
    const floor = unitRect(0x2a2f3a);
    floor.position.set(0, GROUND_Y);
    floor.scale.set(SCREEN_WIDTH, SCREEN_HEIGHT - GROUND_Y);
    const help = new Text({
      text: "J1 : ZQSD (WASD) + F léger, G lourd   ·   J2 : flèches + 1 léger, 2 lourd (pavé num.)   ·   Manettes   ·   F2 : boîtes",
      style: { fill: 0x9aa3b2, fontSize: 15 },
    });
    help.anchor.set(0.5, 0);
    help.position.set(SCREEN_WIDTH / 2, GROUND_Y + 40);
    for (const text of [this.timer, this.title, this.subtitle]) text.anchor.set(0.5);
    this.timer.position.set(SCREEN_WIDTH / 2, BAR_Y + BAR_HEIGHT / 2);
    this.title.position.set(SCREEN_WIDTH / 2, 300);
    this.subtitle.position.set(SCREEN_WIDTH / 2, 380);
    for (const box of this.boxes) box.alpha = 0.35;

    this.root.addChild(
      floor,
      help,
      ...this.fighters.map((f) => f.root),
      ...this.projectiles,
      ...this.boxes,
      ...this.bars.map((b) => b.root),
      this.timer,
      this.title,
      this.subtitle,
    );
  }

  draw(state: State, showBoxes: boolean): void {
    this.fighters.forEach((view, player) => {
      view.update(state, player as 0 | 1);
    });
    this.projectiles.forEach((view, player) => {
      this.updateProjectile(view, state.projectiles[player as 0 | 1]);
    });
    this.bars.forEach((bar, player) => {
      bar.update(state.fighters[player as 0 | 1].health, state.wins[player as 0 | 1]);
    });
    this.drawBoxes(state, showBoxes);

    setText(this.timer, String(timerSeconds(state)));
    const { title, subtitle } = announcement(state);
    setText(this.title, title);
    setText(this.subtitle, subtitle);
    this.drawnFrame = state.frame;
  }

  private createProjectileView(player: 0 | 1): Graphics {
    const radius = toPixels(PROJECTILE.hitbox.h) / 2 + 4;
    return new Graphics()
      .circle(0, 0, radius)
      .fill(PLAYER_COLORS[player])
      .circle(0, 0, radius / 2)
      .fill(0xffffff);
  }

  private updateProjectile(view: Graphics, projectile: Projectile): void {
    view.visible = projectile.active === 1;
    const box = PROJECTILE.hitbox;
    view.position.set(screenX(projectile.x), screenY(projectile.y + box.y + box.h / 2));
  }

  private drawBoxes(state: State, show: boolean): void {
    const boxes = show ? collisionBoxes(state) : [];
    this.boxes.forEach((view, i) => {
      const entry = boxes[i];
      view.visible = entry !== undefined;
      if (entry) this.placeBox(view, entry.box, BOX_COLORS[entry.kind]);
    });
  }

  private placeBox(view: Graphics, box: WorldBox, color: number): void {
    view.tint = color;
    view.position.set(screenX(box.left), screenY(box.top));
    view.scale.set(toPixels(box.right - box.left), toPixels(box.top - box.bottom));
  }
}
