import { replay } from "@hitstop/sim";
import { randomInputs } from "@hitstop/sim/testing";
import { expect, type Page, test } from "@playwright/test";
import type {} from "../src/debug-api.ts";

async function openGame(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(
    () => window.hitstop !== undefined && window.hitstop.drawnFrame() >= 0,
  );
}

// Any uncaught error in the page fails the test, even if the other assertions pass.
let pageErrors: string[] = [];
test.beforeEach(({ page }) => {
  pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
});
test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

test("runs the same simulation as Node, frame by frame, over 100 000 random frames", async ({
  page,
}) => {
  await openGame(page);
  const inputs = randomInputs(20261005, 100_000);
  const browserHashes = await page.evaluate((list) => window.hitstop?.replay(list) ?? [], inputs);
  const nodeHashes = Array.from(replay(inputs).hashes);
  const firstDifference = browserHashes.findIndex((hash, i) => hash !== nodeHashes[i]);
  expect(firstDifference, "first frame where the browser differs from Node").toBe(-1);
  expect(browserHashes).toHaveLength(nodeHashes.length);
});

test("plays a match with the keyboard: display and simulation stay in sync", async ({ page }) => {
  await openGame(page);
  const keyboard = page.keyboard;
  // Wait for the round intro, then both players walk in and fight.
  await page.waitForFunction(() => (window.hitstop?.frame() ?? 0) > 100);
  await keyboard.down("KeyD");
  await keyboard.down("ArrowLeft");
  await page.waitForTimeout(800);
  for (const key of ["KeyF", "Numpad1", "KeyG", "Numpad2", "KeyF"]) {
    await keyboard.press(key);
    await page.waitForTimeout(150);
  }
  await keyboard.up("KeyD");
  await keyboard.up("ArrowLeft");

  const { inputs, hashes, frame, drawnFrame } = await page.evaluate(async () => {
    const api = window.hitstop;
    if (!api) throw new Error("debug API missing");
    // Let the game loop draw first: requestAnimationFrame callbacks run in order.
    await new Promise(requestAnimationFrame);
    return {
      inputs: api.inputs(),
      hashes: api.hashes(),
      frame: api.frame(),
      drawnFrame: api.drawnFrame(),
    };
  });

  expect(drawnFrame).toBe(frame);
  expect(inputs.some(([p1]) => p1 !== 0)).toBe(true);
  expect(inputs.some(([, p2]) => p2 !== 0)).toBe(true);
  expect(Array.from(replay(inputs).hashes)).toEqual(hashes);
});
