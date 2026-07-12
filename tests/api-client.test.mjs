import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAnalysisSchema,
  buildPermissionOrigin,
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

test("parses YouTube timestamps", () => {
  assert.equal(parseTimestamp("02:15"), 135000);
  assert.equal(parseTimestamp("1:02:03"), 3723000);
  assert.equal(parseTimestamp("bad"), null);
});

test("uses a cost-balanced default and exposes supported model choices", () => {
  assert.equal(DEFAULT_SETTINGS.translationModel, "gpt-5.4-mini");
  assert.equal(DEFAULT_SETTINGS.analysisModel, "gpt-5.6-luna");
  assert.deepEqual(MODEL_CATALOG.map((model) => model.id), [
    "gpt-5.4-mini", "gpt-5.6-luna", "gpt-5.4", "gpt-5.6-terra", "gpt-5.5", "gpt-5.6-sol"
  ]);
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
  assert.equal(translation.additionalProperties, false);
  assert.equal(translation.properties.translations.items.additionalProperties, false);
  assert.equal(analysis.additionalProperties, false);
  assert.deepEqual(analysis.required, ["title", "tldr", "keyPoints", "chapters", "glossary"]);
});

test("transcript fingerprints are stable and sensitive to content", async () => {
  const one = await fingerprintTranscript([{ id: "a", startMs: 0, ko: "안녕하세요" }]);
  const two = await fingerprintTranscript([{ id: "a", startMs: 0, ko: "안녕하세요" }]);
  const changed = await fingerprintTranscript([{ id: "a", startMs: 0, ko: "반갑습니다" }]);
  assert.equal(one, two);
  assert.notEqual(one, changed);
  assert.equal(one.length, 64);
});
