import assert from "node:assert/strict";
import test from "node:test";

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.value = "";
    this.checked = false;
    this.hidden = false;
    this.disabled = false;
    this.dataset = {};
    this.style = {};
    this.className = "";
    this.textContent = "";
    this.innerHTML = "";
    this.listeners = new Map();
    this.lastChild = { textContent: "" };
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => this.classes.add(name)),
      remove: (...names) => names.forEach((name) => this.classes.delete(name))
    };
  }

  addEventListener(type, listener) { this.listeners.set(type, listener); }
  setAttribute(name, value) { this[name] = value; }
  getAttribute(name) { return this[name] ?? null; }
  querySelector() { return new FakeElement(); }
  replaceChildren() {}
  append() {}
  scrollIntoView() {}
}

test("loads the complete side-panel module graph and wires critical controls", async () => {
  const elements = new Map();
  const get = (selector) => {
    if (!elements.has(selector)) elements.set(selector, new FakeElement(selector));
    return elements.get(selector);
  };

  const tabs = ["summary", "transcript", "studio", "settings"].map((name) => {
    const element = new FakeElement(`tab-${name}`);
    element.dataset.tab = name;
    return element;
  });
  const modes = ["device", "api"].map((name) => {
    const element = get(`#${name}ModeButton`);
    element.dataset.runMode = name;
    return element;
  });

  globalThis.document = {
    querySelector: get,
    querySelectorAll(selector) {
      if (selector === ".tabs button") return tabs;
      if (selector === "[data-run-mode]") return modes;
      if (selector === ".tabs button, .tab-panel") return [...tabs, get("#summary"), get("#transcript"), get("#studio"), get("#settings")];
      return [];
    },
    createElement: () => new FakeElement()
  };
  globalThis.chrome = {
    storage: {
      local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      session: { get: async () => ({}), set: async () => {}, remove: async () => {} }
    },
    runtime: {
      sendMessage: async (message) => {
        if (message?.type === "SET_SUBTITLES") return { delivered: true };
        if (message?.type === "REQUEST_TRANSCRIPT") {
          return {
            context: { videoId: "video-1", title: "Test video", durationMs: 12_000 },
            source: "youtube-transcript-panel",
            cues: [{ id: "c1", startMs: 0, endMs: 6_000, ko: "테스트 자막", en: "" }]
          };
        }
        return {};
      },
      onMessage: { addListener() {} }
    },
    permissions: { request: async () => true }
  };

  await import(`../sidepanel/sidepanel.js?runtime-smoke=${Date.now()}`);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(get("#apiModeButton").listeners.has("click"), true);
  assert.equal(get("#openSettingsButton").listeners.has("click"), true);
  assert.equal(get("#captureButton").listeners.has("click"), true);
  assert.equal(get("#subtitleToggle").listeners.has("change"), true);
  assert.equal(get("#localAiButton").listeners.has("click"), true);
  assert.equal(tabs.every((tab) => tab.listeners.has("click")), true);

  await get("#apiModeButton").listeners.get("click")();
  assert.equal(get("#apiSettings").hidden, false);
  assert.equal(get("#deviceSettings").hidden, true);
  assert.equal(get("#settings").classes.has("active"), true);
  get("#connectionMode").value = "direct";
  await get("#connectionMode").listeners.get("change")();
  assert.equal(get("#directFields").hidden, false);
  assert.equal(get("#proxyFields").hidden, true);

  get("#subtitleToggle").checked = false;
  await get("#subtitleToggle").listeners.get("change")({ target: get("#subtitleToggle") });
  assert.equal(get("#subtitleStatus").textContent, "Off · overlay hidden");
  assert.match(get("#connectionStatus").textContent, /turned off/i);

  await get("#captureButton").listeners.get("click")();
  assert.equal(get("#transcriptStatus").textContent, "Ready for analysis");
  assert.equal(get("#cueCount").textContent, "1 cues");
  assert.match(get("#connectionStatus").textContent, /Transcript ready/);
});
