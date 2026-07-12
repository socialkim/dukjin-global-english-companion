import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildAnalysisSchema,
  buildPermissionOrigin,
  buildPublishingPackSchema,
  buildTranslationSchema,
  chunkCues,
  DEFAULT_SETTINGS,
  extractOutputText,
  fingerprintTranscript,
  mergeTranslations,
  migrateSettings,
  MODEL_CATALOG,
  OpenAIConnection,
  parseTimestamp
} from "../sidepanel/api-client.js";
import { buildReportHtml, buildReportMarkdown, formatTimestamp, slugify } from "../sidepanel/artifacts.js";
import { analysisFromLocalPack, buildLocalPublishingPack, chooseRepresentativeCues, languageCode, translateObjectStrings } from "../sidepanel/on-device.js";

test("parses YouTube timestamps", () => {
  assert.equal(parseTimestamp("02:15"), 135000);
  assert.equal(parseTimestamp("1:02:03"), 3723000);
  assert.equal(parseTimestamp("bad"), null);
});

test("uses a cost-balanced default and exposes supported model choices", () => {
  assert.equal(DEFAULT_SETTINGS.runMode, "device");
  assert.equal(DEFAULT_SETTINGS.translationModel, "gpt-5.4-mini");
  assert.equal(DEFAULT_SETTINGS.analysisModel, "gpt-5.6-luna");
  assert.deepEqual(MODEL_CATALOG.map((model) => model.id), [
    "gpt-5.4-mini", "gpt-5.6-luna", "gpt-5.4", "gpt-5.6-terra", "gpt-5.5", "gpt-5.6-sol"
  ]);
});

test("migrates processing mode safely", () => {
  assert.equal(migrateSettings({}).runMode, "device");
  assert.equal(migrateSettings({ runMode: "api" }).runMode, "api");
  assert.equal(migrateSettings({ runMode: "unknown" }).runMode, "device");
});

test("migrates the old Sol default to the cheaper balanced pair", () => {
  assert.deepEqual(
    [migrateSettings({ model: "gpt-5.6-sol" }).translationModel, migrateSettings({ model: "gpt-5.6-sol" }).analysisModel],
    ["gpt-5.4-mini", "gpt-5.6-luna"]
  );
  assert.deepEqual(
    [migrateSettings({ model: "gpt-5.4" }).translationModel, migrateSettings({ model: "gpt-5.4" }).analysisModel],
    ["gpt-5.4", "gpt-5.4"]
  );
});

test("routes direct and proxy image requests to GPT Image endpoints", () => {
  const direct = new OpenAIConnection({ ...DEFAULT_SETTINGS, mode: "direct" }, { apiKey: "test-key" });
  const proxy = new OpenAIConnection({ ...DEFAULT_SETTINGS, mode: "proxy", proxyEndpoint: "http://localhost:8787/v1/responses" }, {});
  assert.equal(direct.endpoint("image"), "https://api.openai.com/v1/images/generations");
  assert.equal(proxy.endpoint("image"), "http://localhost:8787/v1/images/generations");
});

test("generates a single portrait GPT Image 2 PNG with the selected quality", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({ data: [{ b64_json: "aW1hZ2U=" }] }) };
  };
  try {
    const client = new OpenAIConnection({ ...DEFAULT_SETTINGS, mode: "direct", imageQuality: "low" }, { apiKey: "test-key" });
    const image = await client.generateIllustratedInfographic({ title: "영상", infographic: { title: "요약" }, language: "Korean" });
    assert.equal(request.url, "https://api.openai.com/v1/images/generations");
    assert.deepEqual(
      { model: request.body.model, size: request.body.size, quality: request.body.quality, format: request.body.output_format, n: request.body.n },
      { model: "gpt-image-2", size: "1024x1536", quality: "low", format: "png", n: 1 }
    );
    assert.equal(image, "data:image/png;base64,aW1hZ2U=");
  } finally { globalThis.fetch = originalFetch; }
});

test("routes subtitles and analysis to their independently selected models", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    const result = body.text.format.name === "video_analysis"
      ? { title: "Title", tldr: "Summary", keyPoints: [], chapters: [], glossary: [] }
      : { translations: [{ id: "c1", text: "Hello" }] };
    return { ok: true, json: async () => ({ output_text: JSON.stringify(result) }) };
  };
  try {
    const client = new OpenAIConnection({
      ...DEFAULT_SETTINGS,
      mode: "direct",
      translationModel: "gpt-5.4-mini",
      analysisModel: "gpt-5.6-luna"
    }, { apiKey: "test-key" });
    await client.analyzeTranscript({ title: "영상", cues: [{ id: "c1", startMs: 0, ko: "안녕" }] });
    await client.translateCues({ title: "영상", cues: [{ id: "c1", startMs: 0, ko: "안녕" }] });
    assert.deepEqual(requests.map((request) => request.model), ["gpt-5.6-luna", "gpt-5.4-mini"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("builds Chrome host permission patterns without unsupported ports", () => {
  assert.equal(buildPermissionOrigin("http://localhost:8787/v1/responses"), "http://localhost/*");
  assert.equal(buildPermissionOrigin("https://proxy.example.com:8443/v1/responses"), "https://proxy.example.com/*");
  assert.throws(() => buildPermissionOrigin("file:///tmp/proxy"), /HTTP or HTTPS/);
});

test("chunks and merges translations without reordering cues", () => {
  const cues = Array.from({ length: 93 }, (_, index) => ({ id: `c${index}`, ko: `문장 ${index}` }));
  assert.deepEqual(chunkCues(cues).map((chunk) => chunk.length), [45, 45, 3]);
  const merged = mergeTranslations(cues.slice(0, 2), [{ id: "c1", text: "second" }, { id: "c0", text: "first" }]);
  assert.deepEqual(merged.map((cue) => cue.en), ["first", "second"]);
});

test("extracts REST Responses output text", () => {
  assert.equal(extractOutputText({ output: [{ content: [{ type: "output_text", text: "READY" }] }] }), "READY");
  assert.throws(() => extractOutputText({ output: [] }), /did not contain output text/);
});

test("structured output schemas are strict", () => {
  const translation = buildTranslationSchema();
  const analysis = buildAnalysisSchema();
  const publishing = buildPublishingPackSchema();
  assert.equal(translation.additionalProperties, false);
  assert.equal(translation.properties.translations.items.additionalProperties, false);
  assert.equal(analysis.additionalProperties, false);
  assert.deepEqual(analysis.required, ["title", "tldr", "keyPoints", "chapters", "glossary"]);
  assert.equal(publishing.additionalProperties, false);
  assert.equal(publishing.properties.infographic.additionalProperties, false);
  assert.equal(publishing.properties.report.properties.sections.items.additionalProperties, false);
});

test("builds downloadable reports with source timestamps and escaped HTML", () => {
  const pack = { report: {
    title: "AI <Report>", subtitle: "One video", executiveSummary: "Grounded summary",
    sections: [{ heading: "Evidence", body: "Body", evidence: [{ text: "Claim", startMs: 65000 }] }],
    recommendations: ["Act carefully"], caveats: ["Verify the transcript"]
  } };
  const video = { id: "abc123", title: "Source video" };
  const markdown = buildReportMarkdown(pack, video, "English");
  const html = buildReportHtml(pack, video, "English");
  assert.match(markdown, /1:05/);
  assert.match(markdown, /youtu\.be\/abc123\?t=65/);
  assert.match(html, /AI &lt;Report&gt;/);
  assert.doesNotMatch(html, /<Report>/);
  assert.equal(formatTimestamp(65000), "1:05");
  assert.equal(slugify("AI report: 2026"), "AI-report-2026");
  assert.match(buildReportMarkdown(pack, video, "Korean"), /핵심 요약/);
  assert.match(buildReportHtml(pack, video, "Japanese"), /エグゼクティブサマリー/);
});

test("transcript fingerprints are stable and sensitive to content", async () => {
  const one = await fingerprintTranscript([{ id: "a", startMs: 0, ko: "안녕하세요" }]);
  const two = await fingerprintTranscript([{ id: "a", startMs: 0, ko: "안녕하세요" }]);
  const changed = await fingerprintTranscript([{ id: "a", startMs: 0, ko: "반갑습니다" }]);
  assert.equal(one, two);
  assert.notEqual(one, changed);
  assert.equal(one.length, 64);
});

test("ships the infographic and report studio controls", async () => {
  const html = await readFile(new URL("../sidepanel/index.html", import.meta.url), "utf8");
  for (const id of ["deviceModeButton", "apiModeButton", "openSettingsButton", "subtitleToggle", "artifactLanguage", "createInfographicButton", "createReportButton", "infographicPreview", "reportPreview", "imageQuality"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
});

test("wires settings shortcuts and persistent subtitle delivery", async () => {
  const sidepanel = await readFile(new URL("../sidepanel/sidepanel.js", import.meta.url), "utf8");
  const background = await readFile(new URL("../background.js", import.meta.url), "utf8");
  assert.match(sidepanel, /openSettingsButton.*addEventListener/);
  assert.match(sidepanel, /switchToApiButton.*addEventListener/);
  assert.match(sidepanel, /subtitleToggle.*addEventListener/);
  assert.match(background, /chrome\.storage\.local\.set\(\{ subtitlesEnabled: enabled \}\)/);
  assert.match(background, /delivered/);
});

test("builds a complete no-API publishing pack from local cues", async () => {
  const cues = Array.from({ length: 12 }, (_, index) => ({
    id: `c${index}`,
    startMs: index * 10_000,
    endMs: index * 10_000 + 8_000,
    ko: `한국어 핵심 문장 ${index + 1}`
  }));
  const representatives = chooseRepresentativeCues(cues, 4);
  assert.deepEqual(representatives.map((cue) => cue.id), ["c0", "c4", "c7", "c11"]);
  const pack = buildLocalPublishingPack({ title: "테스트 방송", cues });
  assert.equal(pack.infographic.facts.length, 3);
  assert.equal(pack.infographic.timeline.length, 4);
  assert.equal(pack.infographic.takeaways.length, 3);
  assert.equal(pack.report.sections.length, 4);
  assert.equal(analysisFromLocalPack(pack).chapters.length, 4);
  const translated = await translateObjectStrings({ title: "제목", startMs: 1000 }, async (text) => `EN:${text}`);
  assert.deepEqual(translated, { title: "EN:제목", startMs: 1000 });
  assert.equal(languageCode("Japanese"), "ja");
});
