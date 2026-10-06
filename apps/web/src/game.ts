import { FixedStepClock } from "@hitstop/protocol";
import {
  Action,
  createInitialState,
  type FrameInput,
  Phase,
  replay,
  type State,
} from "@hitstop/sim";
import { randomInputs } from "@hitstop/sim/testing";
import { Application } from "pixi.js";
import { Controls } from "./controls.ts";
import type { DebugApi } from "./debug-api.ts";
import { Renderer, SCREEN_HEIGHT, SCREEN_WIDTH } from "./renderer.ts";

/** What the game loop drives: a local match or an online one. */
export interface MatchSource {
  /** State to draw. */
  readonly state: State;
  /** Ticks to run for this display frame, given the ticks the fixed-step clock asks for. */
  ticksFor(ticks: number, nowMs: number): number;
  /** One simulation tick, with the inputs of both keyboard sides (or of the scripted player). */
  tick(input: FrameInput): void;
  /** Called once per display frame, after the ticks (e.g. to send network messages). */
  afterTicks?(): void;
  /** Inputs played so far: recorded locally, or confirmed by the server online. */
  readonly inputs: readonly FrameInput[];
  /** Hash after each frame, when the source keeps them (local matches). */
  readonly hashes?: readonly number[];
  /** Extra lines for the debug panel. */
  debugLines(): string[];
}

/** Still picture behind the menus. */
const BACKDROP = createInitialState();

const ACTION_NAMES = Object.fromEntries(Object.entries(Action).map(([name, id]) => [id, name]));
const PHASE_NAMES = Object.fromEntries(Object.entries(Phase).map(([name, id]) => [id, name]));

/** The Gamepad API is missing in some browsers (e.g. WebKit without gamepad support). */
function readGamepads(): readonly (Gamepad | null)[] {
  return typeof navigator.getGamepads === "function" ? navigator.getGamepads() : [];
}

/**
 * Display loop: on each animation frame, runs the simulation ticks that are due, then draws the
 * latest state. Holds no game logic.
 */
export class Game {
  source: MatchSource | undefined;
  private readonly controls = new Controls();
  private readonly clock = new FixedStepClock();
  private readonly renderer = new Renderer();
  private readonly debugPanel: HTMLPreElement;
  private showDebug = false;
  private readonly script: readonly FrameInput[] | undefined;
  private scriptIndex = 0;
  private readonly app: Application;

  private constructor(app: Application, debugPanel: HTMLPreElement, botSeed: number | undefined) {
    this.app = app;
    this.debugPanel = debugPanel;
    this.script = botSeed === undefined ? undefined : randomInputs(botSeed, 60 * 60 * 20);
    app.stage.addChild(this.renderer.root);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", () => this.controls.releaseAll());
    document.addEventListener("visibilitychange", () => this.clock.reset());
    requestAnimationFrame(this.frame);
  }

  static async create(container: HTMLElement, debugPanel: HTMLPreElement, botSeed?: number) {
    const app = new Application();
    await app.init({
      width: SCREEN_WIDTH,
      height: SCREEN_HEIGHT,
      background: "#14161c",
      antialias: true,
      autoStart: false,
    });
    container.appendChild(app.canvas);
    return new Game(app, debugPanel, botSeed);
  }

  /** Hooks for the browser tests, for the current source. */
  debugApi(extra: Pick<DebugApi, "online" | "dropConnection">): DebugApi {
    return {
      frame: () => this.source?.state.frame ?? 0,
      drawnFrame: () => this.renderer.drawnFrame,
      inputs: () => this.source?.inputs.slice() ?? [],
      hashes: () => this.source?.hashes?.slice() ?? [],
      replay: (inputs) => Array.from(replay(inputs).hashes),
      ...extra,
    };
  }

  private readInput(): FrameInput {
    // The scripted player only plays one side (player 1 keys, or our seat online).
    if (this.script) return [this.script[this.scriptIndex++ % this.script.length]?.[0] ?? 0, 0];
    return this.controls.sample(readGamepads());
  }

  private readonly frame = (now: number): void => {
    const source = this.source;
    const ticks = this.clock.advance(now);
    if (source) {
      const due = source.ticksFor(ticks, now);
      for (let i = 0; i < due; i++) source.tick(this.readInput());
      source.afterTicks?.();
      this.renderer.draw(source.state, this.showDebug);
      if (this.showDebug) this.updateDebugPanel(source);
    } else {
      this.renderer.draw(BACKDROP, false, false);
    }
    this.app.render();
    requestAnimationFrame(this.frame);
  };

  private updateDebugPanel(source: MatchSource): void {
    const { state } = source;
    const fighter = (p: 0 | 1) => {
      const f = state.fighters[p];
      return `J${p + 1}  ${ACTION_NAMES[f.action]} (${f.actionFrame})  vie ${f.health}  hitstop ${f.hitstop}`;
    };
    this.debugPanel.textContent = [
      `image ${state.frame}  ${PHASE_NAMES[state.phase]}  manche ${state.round}`,
      ...source.debugLines(),
      fighter(0),
      fighter(1),
    ].join("\n");
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === "F2") {
      this.showDebug = !this.showDebug;
      this.debugPanel.hidden = !this.showDebug;
      event.preventDefault();
    } else if (this.controls.keyDown(event.code)) {
      event.preventDefault();
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (this.controls.keyUp(event.code)) event.preventDefault();
  };
}
