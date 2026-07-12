import {
  DEFAULT_SETTINGS,
  OpenAIConnection,
  clearSessionSecrets,
  fingerprintTranscript,
  loadConnection,
  requestProxyPermission,
  saveConnection
} from "./api-client.js";
import {
  artifactLabels,
  buildReportHtml,
  buildReportMarkdown,
  downloadText,
  downloadUrl,
  formatTimestamp,
  renderInfographicCanvas,
  slugify
} from "./artifacts.js";
import {
  analysisFromLocalPack,
  buildLocalPublishingPack,
  languageCode,
  translateObjectStrings
} from "./on-device.js";

const $ = (selector) => document.querySelector(selector);
let context = null;
let localization = null;
let capturedCues = [];
let transcriptSource = "";
let settings = { ...DEFAULT_SETTINGS };
let secrets = { apiKey: "", proxyToken: "" };
let translator = null;
let translatorLanguage = "";
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

function isApiMode() {
  return settings.runMode === "api";
}

function modeCapabilityMarkup() {
  if (isApiMode()) {
    return "<span>✓ Nuanced summary</span><span>✓ Full report</span><span>✓ Accurate canvas PNG</span><span>✓ GPT Image illustration</span>";
  }
  return "<span>✓ Player subtitles</span><span>✓ Local quick report</span><span>✓ Accurate canvas PNG</span><span class='limited'>— No illustrated AI image</span>";
}

function updateRunModeUi({ announce = false } = {}) {
  const api = isApiMode();
  $("#deviceModeButton").setAttribute("aria-checked", String(!api));
  $("#apiModeButton").setAttribute("aria-checked", String(api));
  $("#modeBadge").textContent = api ? "API REQUIRED" : "NO API KEY";
  $("#modeDescription").textContent = api
    ? "The captured transcript is sent only when you run a job. OpenAI creates nuanced summaries, multilingual subtitles, full reports and optional GPT Image illustrations."
    : "Captions stay on this device. Chrome translates subtitles; the report and accurate canvas infographic use an extractive local brief.";
  $("#modeCapability").innerHTML = modeCapabilityMarkup();
  $("#openSettingsButton").hidden = !api;
  $("#analyzeButton").textContent = api ? "2. Translate + analyze" : "2. Run on device";
  $("#studioModeBadge").textContent = api ? "OPENAI API" : "ON-DEVICE";
  $("#studioModeHelp").textContent = api
    ? "Creates a generative editorial report and infographic plan. The illustrated version uses GPT Image 2."
    : "Creates a private extractive report and an accurate typography-first PNG without an API key.";
  $("#imageApiOptions").hidden = !api;
  $("#settingsTitle").textContent = api ? "OpenAI API mode" : "On-device mode";
  $("#settingsIntro").textContent = api
    ? "Configure a secure proxy or a personal Chrome-session API key."
    : "No API key is used. Chrome may download a local language pack after you approve it.";
  $("#deviceSettings").hidden = api;
  $("#apiSettings").hidden = !api;
  $("#liveCard").hidden = api;
  $("#illustrateButton").textContent = api ? "AI illustrated version" : "API mode required";
  $("#illustrateButton").disabled = !api || !publishingPack || Boolean(currentAbort);
  $("#deviceModelHint").textContent = `${$("#artifactLanguage").value} language pack`;
  if (announce) {
    setConnectionStatus(api
      ? "OpenAI API mode selected. Open Settings to configure a connection before running analysis."
      : "On-device mode selected. No API key is required; prepare Chrome's language pack if translation is needed.");
  }
}

async function setRunMode(mode, { openSettings = false } = {}) {
  const next = mode === "api" ? "api" : "device";
  if (settings.runMode !== next) {
    settings = await saveConnection({ ...settings, runMode: next }, secrets);
    resetPublishingPack();
  }
  updateRunModeUi({ announce: true });
  if (openSettings) {
    switchTab("settings");
    $("#settings").scrollIntoView({ block: "start" });
  }
}

function setBusy(busy) {
  $("#deviceModeButton").disabled = busy;
  $("#apiModeButton").disabled = busy;
  $("#artifactLanguage").disabled = busy;
  $("#captureButton").disabled = busy;
  $("#analyzeButton").disabled = busy || capturedCues.length === 0;
  $("#cancelButton").hidden = !busy;
  $("#createInfographicButton").disabled = busy || capturedCues.length === 0;
  $("#createReportButton").disabled = busy || capturedCues.length === 0;
  $("#illustrateButton").disabled = busy || !publishingPack || !isApiMode();
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
  $("#sourceBadge").textContent = payload.provenance?.reviewed
    ? "CREATOR REVIEWED"
    : payload.provenance?.runMode === "device"
      ? `${payload.english?.language || "AI"} · ON-DEVICE`
      : `${payload.english?.language || "AI"} · OPENAI API`;
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
  $("#infographicMode").textContent = isApiMode() ? "ACCURATE CANVAS" : "ON-DEVICE CANVAS";
  $("#reportLanguage").textContent = language.toUpperCase();
  $("#illustrateButton").textContent = isApiMode() ? "AI illustrated version" : "API mode required";
  $("#illustrateButton").disabled = !isApiMode();
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

async function ensureApiPublishingPack() {
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

async function getOnDeviceTranslator(language, button = null) {
  const targetLanguage = languageCode(language);
  if (targetLanguage === "ko") return null;
  if (translator && translatorLanguage === targetLanguage) return translator;
  if (!("Translator" in self)) throw new Error("Chrome on-device Translator is unavailable. Update Chrome and check built-in AI availability on this device.");
  const options = { sourceLanguage: "ko", targetLanguage };
  const availability = await self.Translator.availability(options);
  if (availability === "unavailable") throw new Error(`The Korean → ${language} on-device language pack is unavailable on this device.`);
  translator = await self.Translator.create({
    ...options,
    monitor(monitor) {
      monitor.addEventListener("downloadprogress", (event) => {
        const percent = Math.round((event.loaded || 0) * 100);
        if (button) button.textContent = `Downloading ${percent}%`;
        setProgress(Math.max(2, Math.min(18, percent * .18)), `Downloading ${language} language pack…`);
      });
    }
  });
  translatorLanguage = targetLanguage;
  return translator;
}

async function translateCuesOnDevice(cues, language, signal) {
  const targetLanguage = languageCode(language);
  if (targetLanguage === "ko") return cues.map((cue) => ({ ...cue, en: cue.ko, source: "on-device-extractive" }));
  const deviceTranslator = await getOnDeviceTranslator(language, $("#localAiButton"));
  const output = new Array(cues.length);
  let cursor = 0;
  let completed = 0;
  const worker = async () => {
    while (cursor < cues.length) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      const index = cursor++;
      const cue = cues[index];
      const translated = await deviceTranslator.translate(cue.ko);
      output[index] = { ...cue, en: translated, source: "on-device-translator" };
      completed += 1;
      setProgress(18 + (completed / cues.length) * 58, `Translated ${completed}/${cues.length} cues on device…`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, cues.length) }, worker));
  return output;
}

async function buildOnDevicePack(language, signal) {
  const sourcePack = buildLocalPublishingPack({ title: context.title, cues: capturedCues });
  if (languageCode(language) === "ko") return sourcePack;
  const deviceTranslator = await getOnDeviceTranslator(language, $("#localAiButton"));
  let translatedFields = 0;
  return translateObjectStrings(sourcePack, async (text) => {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const value = await deviceTranslator.translate(text);
    translatedFields += 1;
    setProgress(Math.min(94, 76 + translatedFields * .45), `Building local ${language} report…`);
    return value;
  });
}

async function ensureOnDevicePublishingPack() {
  if (!capturedCues.length || !context?.videoId) throw new Error("Capture a YouTube transcript first.");
  const language = $("#artifactLanguage").value;
  const signature = `device:${context.videoId}:${language}:${capturedCues.length}:${capturedCues.at(-1)?.startMs || 0}`;
  if (publishingPack && signature === publishingSignature) return publishingPack;
  currentAbort = new AbortController();
  setBusy(true);
  setHeaderStatus("local brief", "busy");
  setProgress(5, "Preparing private on-device publishing pack…");
  try {
    const pack = await buildOnDevicePack(language, currentAbort.signal);
    renderPublishingPack(pack, language);
    publishingSignature = signature;
    setProgress(100, "Local infographic and report ready");
    setConnectionStatus("On-device publishing pack created. No OpenAI API request was made.", "success");
    setHeaderStatus("complete");
    return pack;
  } catch (error) {
    if (error.name === "AbortError") setConnectionStatus("On-device job cancelled.", "error");
    else setConnectionStatus(error.message, "error");
    setHeaderStatus("error", "error");
    throw error;
  } finally { setBusy(false); }
}

async function ensurePublishingPack() {
  return isApiMode() ? ensureApiPublishingPack() : ensureOnDevicePublishingPack();
}

async function openPublishingArtifact(kind) {
  try {
    await ensurePublishingPack();
    switchTab("studio");
    $(kind === "report" ? "#reportPreview" : "#infographicPreview").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch {}
}

async function toggleIllustratedInfographic() {
  if (!isApiMode()) {
    setConnectionStatus("AI illustrated infographics require OpenAI API mode. The accurate canvas PNG is available on device.", "error");
    return;
  }
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
      runMode: settings.runMode,
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
  if (nextSettings.runMode !== "api") throw new Error("Switch to OpenAI API mode before saving an API connection.");
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
  setConnectionStatus("Fetching the complete YouTube transcript without playback…");
  try {
    const result = await chrome.runtime.sendMessage({ type: "REQUEST_TRANSCRIPT", payload: { preferredLanguage: "ko" } });
    context = result?.context || context;
    capturedCues = result?.cues || [];
    transcriptSource = result?.source || "";
    localization = null;
    resetPublishingPack();
    updateTranscriptStatus();
    renderLocalization(null);
    if (!capturedCues.length) {
      throw new Error("No downloadable captions were found for this video. If YouTube offers Show transcript, open it and try again; otherwise live-caption collection remains available as a fallback.");
    }
    if (result?.instant) {
      const trackType = result.track?.kind === "asr"
        ? "auto-generated"
        : result.track?.kind === "panel"
          ? ""
          : "creator-provided";
      const trackName = result.track?.label || result.track?.languageCode || "selected";
      $("#captureHelp").textContent = `${capturedCues.length} cues fetched instantly from the ${trackName}${trackType ? ` ${trackType}` : ""}. No playback required.`;
      setConnectionStatus("Full transcript fetched instantly. Run step 2 in the selected mode.", "success");
    } else {
      $("#captureHelp").textContent = `${capturedCues.length} cues captured from ${transcriptSource.replaceAll("-", " ")}.`;
      setConnectionStatus(isApiMode()
        ? "Transcript ready. Configure the API connection in Settings, then run Translate + analyze."
        : "Transcript ready. Run the private on-device workflow; no API key is required.", "success");
    }
    switchTab("transcript");
  } catch (error) {
    setConnectionStatus(error.message, "error");
  } finally {
    $("#captureButton").disabled = false;
    setHeaderStatus("ready");
  }
}

async function analyzeWithApi() {
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
      transcript: { language: "ko", complete: ["youtube-caption-track", "youtube-transcript-panel", "youtube-transcript-panel-auto"].includes(transcriptSource), cues: translatedCues },
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

async function analyzeOnDevice() {
  if (!capturedCues.length || !context?.videoId) return;
  const language = $("#artifactLanguage").value;
  currentAbort = new AbortController();
  setBusy(true);
  setHeaderStatus("on device", "busy");
  setProgress(2, "Starting private on-device workflow…");
  try {
    const translatedCues = await translateCuesOnDevice(capturedCues, language, currentAbort.signal);
    setProgress(78, "Building extractive summary, report and canvas plan…");
    const sourcePack = buildLocalPublishingPack({ title: context.title, cues: capturedCues });
    const pack = languageCode(language) === "ko"
      ? sourcePack
      : await translateObjectStrings(sourcePack, async (text) => {
          if (currentAbort.signal.aborted) throw new DOMException("Cancelled", "AbortError");
          return translator.translate(text);
        });
    const analysis = analysisFromLocalPack(pack);
    const transcriptHash = await fingerprintTranscript(capturedCues);
    const payload = {
      schemaVersion: 3,
      video: { id: context.videoId, titleKo: context.title, titleEn: analysis.title, durationMs: context.durationMs },
      transcript: { language: "ko", complete: ["youtube-caption-track", "youtube-transcript-panel", "youtube-transcript-panel-auto"].includes(transcriptSource), cues: translatedCues },
      english: {
        language,
        summary: { tldr: analysis.tldr, keyPoints: analysis.keyPoints, chapters: analysis.chapters },
        glossary: []
      },
      provenance: {
        transcriptSource,
        translationProvider: languageCode(language) === "ko" ? "On-device source text" : "Chrome on-device Translator",
        summaryProvider: "On-device extractive brief",
        transcriptHash,
        generatedAt: new Date().toISOString(),
        reviewed: false,
        runMode: "device"
      }
    };
    await chrome.runtime.sendMessage({ type: "PUBLISH_LOCALIZATION", payload });
    renderLocalization(payload);
    renderPublishingPack(pack, language);
    publishingSignature = `device:${context.videoId}:${language}:${capturedCues.length}:${capturedCues.at(-1)?.startMs || 0}`;
    setProgress(100, "On-device subtitles, report and infographic ready");
    setConnectionStatus("Completed privately on device. No OpenAI API request was made.", "success");
    switchTab("summary");
    setHeaderStatus("complete");
  } catch (error) {
    if (error.name === "AbortError") setConnectionStatus("On-device job cancelled.", "error");
    else setConnectionStatus(error.message, "error");
    setHeaderStatus("error", "error");
  } finally { setBusy(false); }
}

async function analyzeVideo() {
  if (isApiMode()) return analyzeWithApi();
  return analyzeOnDevice();
}

async function enableOnDeviceTranslation() {
  const button = $("#localAiButton");
  button.disabled = true;
  const language = $("#artifactLanguage").value;
  try {
    if (languageCode(language) === "ko") {
      button.textContent = "Korean source";
      setConnectionStatus("Korean output uses the visible source captions directly; no language pack is needed.", "success");
      return;
    }
    await getOnDeviceTranslator(language, button);
    button.textContent = "Live ready";
    setConnectionStatus(`On-device Korean → ${language} translation is ready. Keep Korean YouTube captions visible.`, "success");
  } catch (error) {
    button.textContent = "Unavailable";
    setConnectionStatus(error.message, "error");
  } finally { button.disabled = false; }
}

async function initialize() {
  ({ settings, secrets } = await loadConnection());
  populateSettingsForm();
  updateRunModeUi();
  const response = await chrome.runtime.sendMessage({ type: "REQUEST_ACTIVE_VIDEO" });
  $("#subtitleToggle").checked = response?.subtitlesEnabled !== false;
  $("#subtitleStatus").textContent = $("#subtitleToggle").checked ? "On · waiting for translated cues" : "Off · overlay hidden";
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
  } else if (!isApiMode()) {
    setConnectionStatus("On-device mode selected. Capture a transcript to create private subtitles, a quick report and an accurate canvas infographic.");
  } else if (settings.mode === "proxy") {
    setConnectionStatus(`API proxy selected · subtitles ${settings.translationModel} / analysis ${settings.analysisModel}`);
  } else {
    setConnectionStatus(`API session-key mode · subtitles ${settings.translationModel} / analysis ${settings.analysisModel}`);
  }
}

document.querySelectorAll(".tabs button").forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.tab)));
document.querySelectorAll("[data-run-mode]").forEach((button) => button.addEventListener("click", () => setRunMode(button.dataset.runMode, { openSettings: button.dataset.runMode === "api" })));
$("#openSettingsButton").addEventListener("click", () => setRunMode("api", { openSettings: true }));
$("#switchToApiButton").addEventListener("click", () => setRunMode("api", { openSettings: true }));
$("#connectionMode").addEventListener("change", updateModeFields);
$("#artifactLanguage").addEventListener("change", (event) => {
  $("#targetLanguage").value = event.target.value;
  translator = null;
  translatorLanguage = "";
  resetPublishingPack();
  updateRunModeUi();
});
$("#targetLanguage").addEventListener("change", (event) => {
  $("#artifactLanguage").value = event.target.value;
  translator = null;
  translatorLanguage = "";
  resetPublishingPack();
  updateRunModeUi();
});
$("#transcriptSearch").addEventListener("input", (event) => renderTranscript(event.target.value));
$("#subtitleToggle").addEventListener("change", async (event) => {
  const enabled = event.target.checked;
  $("#subtitleStatus").textContent = enabled ? "On · applying to the active player…" : "Off · overlay hidden";
  const response = await chrome.runtime.sendMessage({ type: "SET_SUBTITLES", payload: { enabled } }).catch(() => null);
  if (!enabled) {
    $("#subtitleStatus").textContent = "Off · overlay hidden";
    setConnectionStatus("Player subtitle overlay turned off.", "success");
  } else if (response?.delivered) {
    $("#subtitleStatus").textContent = "On · active on the YouTube player";
    setConnectionStatus("Player subtitle overlay turned on.", "success");
  } else {
    $("#subtitleStatus").textContent = "On · reopen or refresh the YouTube video";
    setConnectionStatus("Subtitle preference was saved, but the active YouTube content script did not respond. Refresh the video tab once.", "error");
  }
});
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
