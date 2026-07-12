import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const extensionPath = resolve(process.env.EXTENSION_PATH || resolve(import.meta.dirname, ".."));
const chromePath = process.env.CHROME_PATH || undefined;
const profilePath = await mkdtemp(join(tmpdir(), "dukjin-global-e2e-"));
let context;

try {
  context = await chromium.launchPersistentContext(profilePath, {
    ...(chromePath ? { executablePath: chromePath } : {}),
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--no-first-run",
      "--disable-default-apps",
      "--window-position=-32000,-32000",
      "--window-size=900,900"
    ]
  });

  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15_000 });
  const extensionId = new URL(worker.url()).host;
  assert.ok(extensionId, "Chrome did not assign an extension ID.");

  const youtubePage = await context.newPage();
  await youtubePage.goto("https://www.youtube.com/watch?v=YTfathQEoXc", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await youtubePage.waitForTimeout(1_500);
  await youtubePage.evaluate(() => {
    const video = document.querySelector("video");
    video?.pause();
    if (video) video.currentTime = 0;
  });

  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`chrome-extension://${extensionId}/sidepanel/index.html`);
  await page.waitForLoadState("domcontentloaded");

  await page.locator("#apiModeButton").click();
  await assertVisible(page.locator("#apiSettings"), "API settings did not open.");
  assert.equal(await page.locator("#settingsTitle").textContent(), "OpenAI API mode");

  await page.locator("#connectionMode").selectOption("direct");
  await assertVisible(page.locator("#directFields"), "Direct API-key fields did not open.");
  await assertVisible(page.locator("#apiKey"), "API-key input is not visible.");

  await page.locator("#deviceModeButton").click();
  assert.equal(await page.locator("#analyzeButton").textContent(), "2. Run on device");
  await page.locator("#artifactLanguage").selectOption({ label: "Korean" });

  await page.locator("label[for='subtitleToggle']").click();
  assert.match(await page.locator("#subtitleStatus").textContent(), /Off · overlay hidden/);

  await youtubePage.evaluate(() => {
    const video = document.querySelector("video");
    video?.pause();
    if (video) video.currentTime = 0;
  });
  const captureStartedAt = Date.now();
  await page.locator("#captureButton").click();
  await page.waitForFunction(() => document.querySelector("#transcriptStatus")?.textContent === "Ready for analysis", null, { timeout: 15_000 });
  assert.equal(await page.locator("#transcriptStatus").textContent(), "Ready for analysis");
  const cueCount = Number.parseInt(await page.locator("#cueCount").textContent(), 10);
  assert.ok(cueCount > 100, `Expected a complete YouTube transcript, received ${cueCount} cues.`);
  assert.match(await page.locator("#connectionStatus").textContent(), /fetched instantly/i);
  assert.match(await page.locator("#captureHelp").textContent(), /No playback required/i);
  const playback = await youtubePage.evaluate(() => ({
    currentTime: document.querySelector("video")?.currentTime || 0,
    duration: document.querySelector("video")?.duration || 0
  }));
  assert.ok(Date.now() - captureStartedAt < 20_000, "Transcript capture took too long.");
  assert.ok(playback.duration - playback.currentTime > 60, "Transcript capture waited for the video to finish.");

  await page.locator("#analyzeButton").click();
  await page.waitForFunction(() => (document.querySelector("#tldr")?.textContent || "").length > 10, null, { timeout: 10_000 });
  assert.equal(await page.locator("#summaryContent").isVisible(), true);
  assert.equal(await page.locator("#studioContent").getAttribute("hidden"), null);
  assert.match(await page.locator("#infographicPreview").getAttribute("src"), /^data:image\/png/);
  assert.match(await page.locator("#connectionStatus").textContent(), /Completed privately on device/i);

  await page.locator("#localAiButton").click();
  await page.waitForFunction(() => document.querySelector("#localAiButton")?.textContent === "Korean source");

  assert.deepEqual(pageErrors, [], `Side-panel page errors: ${pageErrors.join(" | ")}`);
  console.log(`PASS extension ${extensionId}: fetched ${cueCount} real YouTube cues without playback; API settings/key input, subtitles, and the full Korean on-device summary/report/infographic flow are interactive.`);
} finally {
  await context?.close();
  if (profilePath.startsWith(tmpdir())) await rm(profilePath, { recursive: true, force: true });
}

async function assertVisible(locator, message) {
  assert.equal(await locator.isVisible(), true, message);
}
