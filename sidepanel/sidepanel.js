import {
  artifactLabels,
  DEFAULT_SETTINGS,
  OpenAIConnection,
  clearSessionSecrets,
  fingerprintTranscript,
  loadConnection,
  requestProxyPermission,
  saveConnection
} from "./api-client.js";
import {
  buildReportHtml,
  buildReportMarkdown,
  downloadText,
  downloadUrl,
  formatTimestamp,
  renderInfographicCanvas,
  slugify
} from "./artifacts.js";

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
let publishingPack = null;
let publishingSignature = "";
let accurateInfographicDataUrl = "";
let illustratedInfographicDataUrl = "";
let activeInfographicDataUrl = "";

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
  $("#createInfographicButton").disabled = busy || capturedCues.length === 0;
  $("#createReportButton").disabled = busy || capturedCues.length === 0;
  $("#illustrateButton").disabled = busy || !publishingPack;
  if (!busy) currentAbort = null;
}

function seek(timeMs) {
  chrome.runtime.sendMessage({ type: "SEEK_TO", payload: { timeMs } });
}

function updateTranscriptStatus() {
  $("#cueCount").textContent = `${capturedCues.length} cues`;
  $("#transcriptStatus").textContent = capturedCues.length ? "Ready for analysis" : "Not captured";
  $("#analyzeButton").disabled = capturedCues.length === 0 || Boolean(currentAbort);
  $("#createInfographicButton").disabled = capturedCues.length === 0 || Boolean(currentAbort);
  $("#createReportButton").disabled = capturedCues.length === 0 || Boolean(currentAbort);
}

function renderVideoCard() {
  const preview = $("#videoPreview");
  if (!context?.videoId) { preview.hidden = true; return; }
  preview.hidden = false;
  preview.href = `https://youtu.be/${context.videoId}`;
  $("#videoThumbnail").src = `https://i.ytimg.com/vi/${context.videoId}/hqdefault.jpg`;
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

function appendTextList(parent, items, ordered = false) {
  const list = document.createElement(ordered ? "ol" : "ul");
  items.forEach((item) => { const li = document.createElement("li"); li.textContent = item; list.append(li); });
  parent.append(list);
}

function renderReport(report) {
  const labels = artifactLabels($("#artifactLanguage").value);
  const root = $("#reportPreview");
  root.replaceChildren();
  const title = document.createElement("h2");
  const subtitle = document.createElement("p");
  const summary = document.createElement("p");
  title.textContent = report.title;
  subtitle.textContent = report.subtitle;
  summary.className = "report-summary";
  summary.textContent = report.executiveSummary;
  root.append(title, subtitle, summary);
  report.sections.forEach((item) => {
    const section = document.createElement("section");
    const heading = document.createElement("h3");
    const body = document.createElement("p");
    const evidence = document.createElement("ul");
    heading.textContent = item.heading;
    body.textContent = item.body;
    item.evidence.forEach((entry) => {
      const li = document.createElement("li");
      const button = document.createElement("button");
      const text = document.createTextNode(` ${entry.text}`);
      button.className = "timestamp-link";
      button.textContent = formatTimestamp(entry.startMs);
      button.addEventListener("click", () => seek(entry.startMs));
      li.append(button, text);
      evidence.append(li);
    });
    section.append(heading, body, evidence);
    root.append(section);
  });
  const recommendations = document.createElement("section");
  const recommendationsTitle = document.createElement("h3");
  recommendationsTitle.textContent = labels.recommendations;
  recommendations.append(recommendationsTitle);
  appendTextList(recommendations, report.recommendations, true);
  const caveats = document.createElement("section");
  const caveatsTitle = document.createElement("h3");
  caveatsTitle.textContent = labels.caveats;
  caveats.append(caveatsTitle);
  appendTextList(caveats, report.caveats);
  root.append(recommendations, caveats);
}

function renderPublishingPack(pack, language) {
  publishingPack = pack;
  accurateInfographicDataUrl = renderInfographicCanvas(pack.infographic, { id: context.videoId, title: context.title }, language).toDataURL("image/png");
  illustratedInfographicDataUrl = "";
  activeInfographicDataUrl = accurateInfographicDataUrl;
  $("#studioEmpty").hidden = true;
  $("#studioContent").hidden = false;
  $("#infographicPreview").src = activeInfographicDataUrl;
  $("#infographicMode").textContent = "ACCURATE CANVAS";
  $("#reportLanguage").textContent = language.toUpperCase();
  $("#illustrateButton").textContent = "AI illustrated version";
  $("#illustrateButton").disabled = false;
  renderReport(pack.report);
}

function resetPublishingPack() {
  publishingPack = null;
  publishingSignature = "";
  accurateInfographicDataUrl = "";
  illustratedInfographicDataUrl = "";
  activeInfographicDataUrl = "";
  $("#studioEmpty").hidden = false;
  $("#studioContent").hidden = true;
}

async function ensurePublishingPack() {
  if (!capturedCues.length || !context?.videoId) throw new Error("Capture a YouTube transcript first.");
  const language = $("#artifactLanguage").value;
  const signature = `${context.videoId}:${language}:${capturedCues.length}:${capturedCues.at(-1)?.startMs || 0}`;
  if (publishingPack && signature === publishingSignature) return publishingPack;
  $("#targetLanguage").value = language;
  currentAbort = new AbortController();
  setBusy(true);
  setHeaderStatus("publishing", "busy");
  setProgress(5, `Preparing ${language} publishing pack…`);
  try {
    const client = await saveSettingsFromForm();
    setProgress(20, "Grounding infographic and report in the transcript…");
    const pack = await client.createPublishingPack({ title: context.title, cues: capturedCues, language, signal: currentAbort.signal });
    setProgress(82, "Rendering accurate infographic PNG…");
    renderPublishingPack(pack, language);
    publishingSignature = signature;
    setProgress(100, "Infographic and report ready");
    setConnectionStatus(`Publishing pack created in ${language} with ${settings.analysisModel}.`, "success");
    setHeaderStatus("complete");
    return pack;
  } catch (error) {
    if (error.name === "AbortError") setConnectionStatus("Publishing cancelled.", "error");
    else setConnectionStatus(error.message, "error");
    setHeaderStatus("error", "error");
    throw error;
  } finally { setBusy(false); }
}

async function openPublishingArtifact(kind) {
  try {
    await ensurePublishingPack();
    switchTab("studio");
    $(kind === "report" ? "#reportPreview" : "#infographicPreview").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch {}
}

async function toggleIllustratedInfographic() {
  if (!publishingPack) return;
  if (illustratedInfographicDataUrl && activeInfographicDataUrl === illustratedInfographicDataUrl) {
    activeInfographicDataUrl = accurateInfographicDataUrl;
    $("#infographicPreview").src = activeInfographicDataUrl;
    $("#infographicMode").textContent = "ACCURATE CANVAS";
    $("#illustrateButton").textContent = "AI illustrated version";
    return;
  }
  if (illustratedInfographicDataUrl) {
    activeInfographicDataUrl = illustratedInfographicDataUrl;
    $("#infographicPreview").src = activeInfographicDataUrl;
    $("#infographicMode").textContent = "GPT IMAGE 2";
    $("#illustrateButton").textContent = "Restore accurate canvas";
    return;
  }
  currentAbort = new AbortController();
  setBusy(true);
  setHeaderStatus("illustrating", "busy");
  setProgress(8, "Sending the grounded design brief to GPT Image 2…");
  try {
    const client = await saveSettingsFromForm();
    illustratedInfographicDataUrl = await client.generateIllustratedInfographic({
      title: context.title,
      infographic: publishingPack.infographic,
      language: $("#artifactLanguage").value,
      signal: currentAbort.signal
    });
    activeInfographicDataUrl = illustratedInfographicDataUrl;
    $("#infographicPreview").src = activeInfographicDataUrl;
    $("#infographicMode").textContent = "GPT IMAGE 2";
    $("#illustrateButton").textContent = "Restore accurate canvas";
    setProgress(100, "AI illustrated infographic ready");
    setConnectionStatus("GPT Image 2 illustration created. Review all rendered wording before publishing.", "success");
    setHeaderStatus("complete");
  } catch (error) {
    if (error.name !== "AbortError") setConnectionStatus(error.message, "error");
    setHeaderStatus("error", "error");
  } finally { setBusy(false); }
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
  $("#translationModel").value = settings.translationModel;
  $("#analysisModel").value = settings.analysisModel;
  $("#targetLanguage").value = settings.targetLanguage;
  $("#artifactLanguage").value = settings.targetLanguage;
  $("#imageQuality").value = settings.imageQuality;
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
      translationModel: $("#translationModel").value,
      analysisModel: $("#analysisModel").value,
      imageQuality: $("#imageQuality").value,
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
  setConnectionStatus(`${settings.mode === "proxy" ? "Secure proxy" : "Session key"} saved · subtitles ${settings.translationModel} / summary ${settings.analysisModel}`, "success");
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
    resetPublishingPack();
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
        translationProvider: `OpenAI ${settings.translationModel}`,
        summaryProvider: `OpenAI ${settings.analysisModel}`,
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
    renderVideoCard();
  }
  renderLocalization(response?.localization || null);
  if (response?.localization) {
    capturedCues = response.localization.transcript?.cues || [];
    transcriptSource = response.localization.provenance?.transcriptSource || "cached";
    updateTranscriptStatus();
    setConnectionStatus("Loaded a cached analysis for this video.", "success");
  } else if (settings.mode === "proxy") {
    setConnectionStatus(`Proxy configured · subtitles ${settings.translationModel} / summary ${settings.analysisModel}`);
  } else {
    setConnectionStatus(`Session-key mode · subtitles ${settings.translationModel} / summary ${settings.analysisModel}`);
  }
}

document.querySelectorAll(".tabs button").forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.tab)));
$("#connectionMode").addEventListener("change", updateModeFields);
$("#artifactLanguage").addEventListener("change", (event) => { $("#targetLanguage").value = event.target.value; resetPublishingPack(); });
$("#targetLanguage").addEventListener("change", (event) => { $("#artifactLanguage").value = event.target.value; resetPublishingPack(); });
$("#transcriptSearch").addEventListener("input", (event) => renderTranscript(event.target.value));
$("#subtitleToggle").addEventListener("change", (event) => chrome.runtime.sendMessage({ type: "SET_SUBTITLES", payload: { enabled: event.target.checked } }));
$("#captureButton").addEventListener("click", captureTranscript);
$("#analyzeButton").addEventListener("click", analyzeVideo);
$("#createInfographicButton").addEventListener("click", () => openPublishingArtifact("infographic"));
$("#createReportButton").addEventListener("click", () => openPublishingArtifact("report"));
$("#illustrateButton").addEventListener("click", toggleIllustratedInfographic);
$("#downloadInfographicButton").addEventListener("click", () => {
  if (!activeInfographicDataUrl || !publishingPack) return;
  downloadUrl(activeInfographicDataUrl, `${slugify(publishingPack.infographic.title)}-${slugify($("#artifactLanguage").value)}-infographic.png`);
});
$("#downloadMarkdownButton").addEventListener("click", () => {
  if (!publishingPack) return;
  const language = $("#artifactLanguage").value;
  downloadText(buildReportMarkdown(publishingPack, { id: context.videoId, title: context.title }, language), `${slugify(publishingPack.report.title)}.md`, "text/markdown;charset=utf-8");
});
$("#downloadHtmlButton").addEventListener("click", () => {
  if (!publishingPack) return;
  const language = $("#artifactLanguage").value;
  downloadText(buildReportHtml(publishingPack, { id: context.videoId, title: context.title }, language), `${slugify(publishingPack.report.title)}.html`, "text/html;charset=utf-8");
});
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
  resetPublishingPack();
  updateTranscriptStatus();
  renderLocalization(null);
  setConnectionStatus("Cached analysis and captured live cues cleared.", "success");
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "VIDEO_CONTEXT_CHANGED") {
    if (message.payload?.videoId !== context?.videoId) {
      context = { ...message.payload, tabId: context?.tabId };
      capturedCues = [];
      localization = null;
      resetPublishingPack();
      $("#videoTitle").textContent = context.title || "Active YouTube video";
      $("#videoTitleKo").textContent = `YouTube ID · ${context.videoId}`;
      $("#sourceBadge").textContent = "ACTIVE YOUTUBE VIDEO";
      renderVideoCard();
      updateTranscriptStatus();
      renderLocalization(null);
    }
    return;
  }
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
