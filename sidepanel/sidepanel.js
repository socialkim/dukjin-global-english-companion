import {
  DEFAULT_SETTINGS,
  OpenAIConnection,
  clearSessionSecrets,
  fingerprintTranscript,
  loadConnection,
  requestProxyPermission,
  saveConnection
} from "./api-client.js";

const $ = (selector) => document.querySelector(selector);
let context = null;
let localization = null;
let capturedCues = [];
let transcriptSource = "";
let settings = { ...DEFAULT_SETTINGS };
let secrets = { apiKey: "", proxyToken: "" };
let translator = null;
let translationQueue = Promise.resolve();
let lastObservedKey = "";
let currentAbort = null;

function formatTime(ms) {
  const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function setHeaderStatus(label, state = "ready") {
  $("#headerStatus").lastChild.textContent = ` ${label.toUpperCase()}`;
  $("#headerStatus").querySelector("i").style.background = state === "error" ? "#ff766a" : state === "busy" ? "#f3b83f" : "#53d28c";
}

function setConnectionStatus(message, type = "") {
  const element = $("#connectionStatus");
  element.textContent = message;
  element.className = `connection-status ${type}`.trim();
}

function setProgress(percent, label) {
  $("#progressPanel").hidden = false;
  $("#analysisProgress").value = Math.max(0, Math.min(100, percent));
  $("#progressPercent").textContent = `${Math.round(percent)}%`;
  $("#progressLabel").textContent = label;
}

function setBusy(busy) {
  $("#captureButton").disabled = busy;
  $("#analyzeButton").disabled = busy || capturedCues.length === 0;
  $("#cancelButton").hidden = !busy;
  if (!busy) currentAbort = null;
}

function seek(timeMs) {
  chrome.runtime.sendMessage({ type: "SEEK_TO", payload: { timeMs } });
}

function updateTranscriptStatus() {
  $("#cueCount").textContent = `${capturedCues.length} cues`;
  $("#transcriptStatus").textContent = capturedCues.length ? "Ready for analysis" : "Not captured";
  $("#analyzeButton").disabled = capturedCues.length === 0 || Boolean(currentAbort);
}

function renderTranscript(filter = "") {
  const needle = filter.trim().toLowerCase();
  const cues = (localization?.transcript?.cues?.length ? localization.transcript.cues : capturedCues)
    .filter((cue) => !needle || `${cue.en || ""} ${cue.ko || ""}`.toLowerCase().includes(needle));
  $("#transcriptList").replaceChildren(...cues.map((cue) => {
    const button = document.createElement("button");
    const time = document.createElement("time");
    const translated = document.createElement("span");
    const source = document.createElement("small");
    time.textContent = formatTime(cue.startMs);
    translated.textContent = cue.en || "Translation pending";
    source.textContent = cue.ko || "";
    button.append(time, translated, source);
    button.addEventListener("click", () => seek(cue.startMs));
    return button;
  }));
}

function renderGlossary(items = []) {
  $("#glossaryEmpty").hidden = items.length > 0;
  $("#glossaryList").replaceChildren(...items.map((item) => {
    const row = document.createElement("div");
    row.className = "glossary-row";
    const source = document.createElement("b");
    const target = document.createElement("span");
    const note = document.createElement("p");
    source.textContent = item.source;
    target.textContent = item.target;
    note.textContent = item.note;
    row.append(source, target, note);
    return row;
  }));
}

function renderLocalization(payload) {
  localization = payload || null;
  if (!payload) {
    $("#summaryEmpty").hidden = false;
    $("#summaryContent").hidden = true;
    renderGlossary([]);
    renderTranscript($("#transcriptSearch").value);
    return;
  }
  capturedCues = payload.transcript?.cues || capturedCues;
  $("#sourceBadge").textContent = payload.provenance?.reviewed ? "CREATOR REVIEWED" : `${payload.english?.language || "AI"} · AI GENERATED`;
  $("#videoTitle").textContent = payload.video?.titleEn || context?.title || "Analyzed video";
  $("#videoTitleKo").textContent = payload.video?.titleKo || context?.title || "";
  $("#summaryEmpty").hidden = true;
  $("#summaryContent").hidden = false;
  $("#tldr").textContent = payload.english?.summary?.tldr || "";
  const points = payload.english?.summary?.keyPoints || [];
  $("#keyPointCount").textContent = `${points.length} points`;
  $("#keyPoints").replaceChildren(...points.map((point, index) => {
    const li = document.createElement("li");
    const number = document.createElement("i");
    const text = document.createElement("button");
    const time = document.createElement("time");
    number.textContent = String(index + 1).padStart(2, "0");
    text.textContent = point.text;
    time.textContent = formatTime(point.startMs);
    text.addEventListener("click", () => seek(point.startMs));
    li.append(number, text, time);
    return li;
  }));
  $("#chapters").replaceChildren(...(payload.english?.summary?.chapters || []).map((chapter) => {
    const button = document.createElement("button");
    const time = document.createElement("time");
    const title = document.createElement("span");
    const arrow = document.createElement("b");
    time.textContent = formatTime(chapter.startMs);
    title.textContent = chapter.title;
    arrow.textContent = "→";
    button.append(time, title, arrow);
    button.addEventListener("click", () => seek(chapter.startMs));
    return button;
  }));
  renderGlossary(payload.english?.glossary || []);
  updateTranscriptStatus();
  renderTranscript($("#transcriptSearch").value);
}

function switchTab(tabName) {
  document.querySelectorAll(".tabs button, .tab-panel").forEach((item) => item.classList.remove("active"));
  document.querySelector(`.tabs button[data-tab='${tabName}']`)?.classList.add("active");
  $(`#${tabName}`)?.classList.add("active");
}

function updateModeFields() {
  const direct = $("#connectionMode").value === "direct";
  $("#directFields").hidden = !direct;
  $("#proxyFields").hidden = direct;
}

function populateSettingsForm() {
  $("#connectionMode").value = settings.mode;
  $("#proxyEndpoint").value = settings.proxyEndpoint;
  $("#model").value = settings.model;
  $("#targetLanguage").value = settings.targetLanguage;
  $("#translationStyle").value = settings.translationStyle;
  $("#apiKey").value = secrets.apiKey;
  $("#proxyToken").value = secrets.proxyToken;
  $("#directConsent").checked = settings.mode === "direct" && Boolean(secrets.apiKey);
  updateModeFields();
}

function readSettingsForm() {
  return {
    nextSettings: {
      mode: $("#connectionMode").value,
      proxyEndpoint: $("#proxyEndpoint").value,
      model: $("#model").value,
      targetLanguage: $("#targetLanguage").value,
      translationStyle: $("#translationStyle").value
    },
    nextSecrets: { apiKey: $("#apiKey").value, proxyToken: $("#proxyToken").value }
  };
}

async function saveSettingsFromForm() {
  const { nextSettings, nextSecrets } = readSettingsForm();
  if (nextSettings.mode === "direct" && !$("#directConsent").checked) throw new Error("Confirm the direct-key warning first.");
  if (nextSettings.mode === "proxy") {
    const granted = await requestProxyPermission(nextSettings.proxyEndpoint);
    if (!granted) throw new Error("Host permission for the proxy endpoint was not granted.");
  }
  settings = await saveConnection(nextSettings, nextSecrets);
  secrets = nextSecrets;
  setConnectionStatus(`${settings.mode === "proxy" ? "Secure proxy" : "Session key"} saved · ${settings.model}`, "success");
  return new OpenAIConnection(settings, secrets);
}

async function captureTranscript() {
  setHeaderStatus("capturing", "busy");
  $("#captureButton").disabled = true;
  setConnectionStatus("Reading the visible YouTube transcript panel…");
  try {
    const result = await chrome.runtime.sendMessage({ type: "REQUEST_TRANSCRIPT" });
    context = result?.context || context;
    capturedCues = result?.cues || [];
    transcriptSource = result?.source || "";
    localization = null;
    updateTranscriptStatus();
    renderLocalization(null);
    if (!capturedCues.length) {
      throw new Error("No transcript found. On YouTube, open the description/menu and choose Show transcript, then try again. You can also watch with Korean captions to collect cues live.");
    }
    $("#captureHelp").textContent = `${capturedCues.length} cues captured from ${transcriptSource.replaceAll("-", " ")}.`;
    setConnectionStatus("Transcript ready. Configure Settings, then run Translate + analyze.", "success");
    switchTab("transcript");
  } catch (error) {
    setConnectionStatus(error.message, "error");
  } finally {
    $("#captureButton").disabled = false;
    setHeaderStatus("ready");
  }
}

async function analyzeVideo() {
  if (!capturedCues.length || !context?.videoId) return;
  currentAbort = new AbortController();
  setBusy(true);
  setHeaderStatus("analyzing", "busy");
  setProgress(2, "Connecting to AI…");
  try {
    const client = await saveSettingsFromForm();
    setProgress(8, "Building grounded summary and glossary…");
    const analysis = await client.analyzeTranscript({ title: context.title, cues: capturedCues, signal: currentAbort.signal });
    setProgress(35, "Summary ready · translating subtitles…");
    const translatedCues = await client.translateCues({
      cues: capturedCues,
      title: context.title,
      glossary: analysis.glossary,
      signal: currentAbort.signal,
      onProgress({ completed, total, cueCount }) {
        const percent = 35 + (completed / total) * 60;
        setProgress(percent, `Translated ${cueCount}/${capturedCues.length} cues · batch ${completed}/${total}`);
      }
    });
    const transcriptHash = await fingerprintTranscript(capturedCues);
    const payload = {
      schemaVersion: 2,
      video: {
        id: context.videoId,
        titleKo: context.title,
        titleEn: analysis.title,
        durationMs: context.durationMs
      },
      transcript: { language: "ko", complete: transcriptSource === "youtube-transcript-panel", cues: translatedCues },
      english: {
        language: settings.targetLanguage,
        summary: { tldr: analysis.tldr, keyPoints: analysis.keyPoints, chapters: analysis.chapters },
        glossary: analysis.glossary
      },
      provenance: {
        transcriptSource,
        translationProvider: `OpenAI ${settings.model}`,
        summaryProvider: `OpenAI ${settings.model}`,
        transcriptHash,
        generatedAt: new Date().toISOString(),
        reviewed: false
      }
    };
    await chrome.runtime.sendMessage({ type: "PUBLISH_LOCALIZATION", payload });
    renderLocalization(payload);
    setProgress(100, "Complete · subtitles synced to the player");
    setConnectionStatus(`${translatedCues.length} cues translated and cached locally.`, "success");
    switchTab("summary");
    setHeaderStatus("complete");
  } catch (error) {
    if (error.name === "AbortError") setConnectionStatus("Analysis cancelled. No partial result was published.", "error");
    else setConnectionStatus(error.message, "error");
    setHeaderStatus("error", "error");
  } finally {
    setBusy(false);
  }
}

async function enableOnDeviceTranslation() {
  const button = $("#localAiButton");
  button.disabled = true;
  try {
    if (!("Translator" in self)) throw new Error("Chrome on-device Translator is unavailable on this device.");
    const availability = await self.Translator.availability({ sourceLanguage: "ko", targetLanguage: "en" });
    if (availability === "unavailable") throw new Error("The Korean → English language pack is unavailable.");
    translator = await self.Translator.create({
      sourceLanguage: "ko",
      targetLanguage: "en",
      monitor(monitor) {
        monitor.addEventListener("downloadprogress", (event) => {
          button.textContent = `Downloading ${Math.round((event.loaded || 0) * 100)}%`;
        });
      }
    });
    button.textContent = "Live ready";
    setConnectionStatus("On-device live translation enabled. Keep Korean YouTube captions visible.", "success");
  } catch (error) {
    button.textContent = "Unavailable";
    setConnectionStatus(error.message, "error");
  } finally { button.disabled = false; }
}

async function initialize() {
  ({ settings, secrets } = await loadConnection());
  populateSettingsForm();
  const response = await chrome.runtime.sendMessage({ type: "REQUEST_ACTIVE_VIDEO" });
  context = response?.context || null;
  if (context?.title) {
    $("#videoTitle").textContent = context.title;
    $("#videoTitleKo").textContent = `YouTube ID · ${context.videoId}`;
    $("#sourceBadge").textContent = "ACTIVE YOUTUBE VIDEO";
  }
  renderLocalization(response?.localization || null);
  if (response?.localization) {
    capturedCues = response.localization.transcript?.cues || [];
    transcriptSource = response.localization.provenance?.transcriptSource || "cached";
    updateTranscriptStatus();
    setConnectionStatus("Loaded a cached analysis for this video.", "success");
  } else if (settings.mode === "proxy") {
    setConnectionStatus(`Proxy configured · ${settings.model}`);
  } else {
    setConnectionStatus(`Session-key mode · ${settings.model}`);
  }
}

document.querySelectorAll(".tabs button").forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.tab)));
$("#connectionMode").addEventListener("change", updateModeFields);
$("#transcriptSearch").addEventListener("input", (event) => renderTranscript(event.target.value));
$("#subtitleToggle").addEventListener("change", (event) => chrome.runtime.sendMessage({ type: "SET_SUBTITLES", payload: { enabled: event.target.checked } }));
$("#captureButton").addEventListener("click", captureTranscript);
$("#analyzeButton").addEventListener("click", analyzeVideo);
$("#cancelButton").addEventListener("click", () => currentAbort?.abort());
$("#localAiButton").addEventListener("click", enableOnDeviceTranslation);
$("#saveSettingsButton").addEventListener("click", async () => {
  try { await saveSettingsFromForm(); }
  catch (error) { setConnectionStatus(error.message, "error"); }
});
$("#testConnectionButton").addEventListener("click", async () => {
  const button = $("#testConnectionButton");
  button.disabled = true;
  setConnectionStatus("Testing the OpenAI Responses connection…");
  try {
    const client = await saveSettingsFromForm();
    const result = await client.test();
    setConnectionStatus(`Connection successful · ${result.slice(0, 40)}`, "success");
  } catch (error) { setConnectionStatus(error.message, "error"); }
  finally { button.disabled = false; }
});
$("#forgetSecretsButton").addEventListener("click", async () => {
  await clearSessionSecrets();
  secrets = { apiKey: "", proxyToken: "" };
  $("#apiKey").value = "";
  $("#proxyToken").value = "";
  setConnectionStatus("Session credentials deleted.", "success");
});
$("#clearVideoButton").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "CLEAR_VIDEO_DATA" });
  localization = null;
  capturedCues = [];
  updateTranscriptStatus();
  renderLocalization(null);
  setConnectionStatus("Cached analysis and captured live cues cleared.", "success");
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "LIVE_CAPTION" || !message.payload?.ko) return;
  const payload = message.payload;
  const key = `${payload.videoId}:${payload.timeMs}:${payload.ko}`;
  if (key === lastObservedKey) return;
  lastObservedKey = key;
  if (!capturedCues.length || transcriptSource === "watched-live-captions") {
    transcriptSource = "watched-live-captions";
    const cue = { id: `live-${payload.timeMs}`, startMs: payload.timeMs, endMs: payload.timeMs + 6500, ko: payload.ko, en: "", source: "youtube-live" };
    if (capturedCues.at(-1)?.ko !== cue.ko) capturedCues.push(cue);
    updateTranscriptStatus();
    renderTranscript($("#transcriptSearch").value);
  }
  if (!translator) return;
  translationQueue = translationQueue.then(async () => {
    const translated = await translator.translate(payload.ko);
    const cue = { id: `device-${payload.timeMs}`, startMs: payload.timeMs, endMs: payload.timeMs + 6500, ko: payload.ko, en: translated, source: "on-device" };
    await chrome.runtime.sendMessage({ type: "RENDER_LIVE_CUE", payload: { videoId: payload.videoId, cue } });
    const live = $("#liveTranslation");
    live.hidden = false;
    live.querySelector("b").textContent = translated;
    live.querySelector("span").textContent = payload.ko;
  }).catch(() => {});
});

initialize().catch((error) => setConnectionStatus(error.message, "error"));
