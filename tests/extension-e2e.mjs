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
    document.title = "Dukjin Global E2E - YouTube";
    const host = document.createElement("div");
    host.id = "dukjin-e2e-transcript";
    [["0:00", "첫 번째 테스트 자막입니다."], ["0:06", "두 번째 테스트 자막입니다."]].forEach(([time, text]) => {
      const row = document.createElement("div");
      const timestamp = document.createElement("span");
      const content = document.createElement("span");
      row.className = "ytwTranscriptSegmentViewModelHost";
      row.setAttribute("role", "button");
      timestamp.className = "ytwTranscriptSegmentViewModelTimestamp";
      content.className = "ytwTranscriptSegmentViewModelText";
      timestamp.textContent = time;
      content.textContent = text;
      row.append(timestamp, content);
      host.append(row);
    });
    document.body.append(host);
  });
  await youtubePage.waitForTimeout(300);

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

  await page.locator("#captureButton").click();
  await page.waitForFunction(() => document.querySelector("#transcriptStatus")?.textContent === "Ready for analysis", null, { timeout: 8_000 });
  assert.equal(await page.locator("#transcriptStatus").textContent(), "Ready for analysis");
  assert.equal(await page.locator("#cueCount").textContent(), "2 cues");
  assert.match(await page.locator("#connectionStatus").textContent(), /Transcript ready/i);

  await page.locator("#analyzeButton").click();
  await page.waitForFunction(() => (document.querySelector("#tldr")?.textContent || "").length > 10, null, { timeout: 10_000 });
  assert.equal(await page.locator("#summaryContent").isVisible(), true);
  assert.equal(await page.locator("#studioContent").getAttribute("hidden"), null);
  assert.match(await page.locator("#infographicPreview").getAttribute("src"), /^data:image\/png/);
  assert.match(await page.locator("#connectionStatus").textContent(), /Completed privately on device/i);

  await page.locator("#localAiButton").click();
  await page.waitForFunction(() => document.querySelector("#localAiButton")?.textContent === "Korean source");

  assert.deepEqual(pageErrors, [], `Side-panel page errors: ${pageErrors.join(" | ")}`);
  console.log(`PASS extension ${extensionId}: API settings/key input, subtitles, YouTube transcript capture, and the full Korean on-device summary/report/infographic flow are interactive.`);
} finally {
  await context?.close();
  if (profilePath.startsWith(tmpdir())) await rm(profilePath, { recursive: true, force: true });
}

async function assertVisible(locator, message) {
  assert.equal(await locator.isVisible(), true, message);
}
