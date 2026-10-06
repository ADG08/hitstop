import { replay } from "@hitstop/sim";
import { randomInputs } from "@hitstop/sim/testing";
import { expect, type Page, test } from "@playwright/test";
import type {} from "../src/debug-api.ts";

async function openGame(page: Page, path = "/"): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.hitstop !== undefined);
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
  await page.getByRole("button", { name: "Jouer à deux sur ce clavier" }).click();
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

test("plays a full online match between two browsers with 100 ms of latency and a cut", async ({
  browser,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "the network does not depend on the engine (checked above)",
  );
  test.setTimeout(8 * 60_000);
  const network = "latency=100&jitter=10&loss=0.02";
  const host = await (await browser.newContext()).newPage();
  const guest = await (await browser.newContext()).newPage();
  for (const page of [host, guest]) {
    page.on("pageerror", (error) => pageErrors.push(String(error)));
  }

  await openGame(host, `/?${network}&bot=11`);
  await host.getByRole("button", { name: "Créer un salon en ligne" }).click();
  const code = await host.getByTestId("room-code").textContent();
  expect(code).toMatch(/^[A-Z0-9]{4}$/);
  await openGame(guest, `/?room=${code}&${network}&bot=12`);

  // Cut the guest's connection in the middle of the match: it must come back by itself.
  await guest.waitForFunction(() => (window.hitstop?.online()?.confirmedFrame ?? 0) > 600);
  await guest.evaluate(() => window.hitstop?.dropConnection());
  await guest.waitForFunction(() => window.hitstop?.online()?.connection === "reconnecting");
  await guest.waitForFunction(() => window.hitstop?.online()?.connection === "open");

  const ends = await Promise.all(
    [host, guest].map(async (page) => {
      await page.waitForFunction(() => window.hitstop?.online()?.end !== undefined, null, {
        timeout: 7 * 60_000,
      });
      await expect(page.getByTestId("match-check")).toHaveText(/Partie vérifiée/);
      return page.evaluate(() => window.hitstop?.online()?.end);
    }),
  );
  const [hostEnd, guestEnd] = ends;
  expect(hostEnd?.verified).toBe(true);
  expect(guestEnd?.verified).toBe(true);
  expect(guestEnd?.settledHash).toBe(hostEnd?.settledHash);
  expect(hostEnd?.settledHash).toBe(hostEnd?.hash);
});
