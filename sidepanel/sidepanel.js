const $ = (selector) => document.querySelector(selector);
let localization = null;
let translator = null;
let translationQueue = Promise.resolve();
let lastObservedKey = "";

function formatTime(ms) {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function seek(timeMs) {
  chrome.runtime.sendMessage({ type: "SEEK_TO", payload: { timeMs } });
}

function render(payload, context) {
  localization = payload;
  if (!payload) {
    $("#emptyState").hidden = false;
    $("#appState").hidden = true;
    if (context?.title) { $("#videoTitle").textContent = context.title; $("#videoTitleKo").textContent = "No reviewed English package is available for this episode yet."; }
    return;
  }
  $("#emptyState").hidden = true;
  $("#appState").hidden = false;
  $("#sourceBadge").textContent = payload.provenance.reviewed ? "CREATOR CAPTIONS" : "BUNDLED PRODUCT DEMO";
  $("#videoTitle").textContent = payload.video.titleEn;
  $("#videoTitleKo").textContent = payload.video.titleKo;
  $("#tldr").textContent = payload.english.summary.tldr;

  const points = payload.english.summary.keyPoints;
  $("#keyPointCount").textContent = `${points.length} points`;
  $("#keyPoints").replaceChildren(...points.map((point, index) => {
    const li = document.createElement("li");
    const number = document.createElement("i"); number.textContent = String(index + 1).padStart(2, "0");
    const text = document.createElement("button"); text.textContent = point.text; text.addEventListener("click", () => seek(point.startMs || 0));
    const time = document.createElement("time"); time.textContent = formatTime(point.startMs || 0);
    li.append(number, text, time); return li;
  }));

  $("#chapters").replaceChildren(...payload.english.summary.chapters.map((chapter) => {
    const button = document.createElement("button"); button.innerHTML = `<time>${formatTime(chapter.startMs)}</time><span>${chapter.title}</span><b>→</b>`; button.addEventListener("click", () => seek(chapter.startMs)); return button;
  }));
  renderTranscript("");
}

function renderTranscript(filter) {
  if (!localization) return;
  const needle = filter.trim().toLowerCase();
  const cues = localization.transcript.cues.filter((cue) => !needle || `${cue.en} ${cue.ko}`.toLowerCase().includes(needle));
  $("#transcriptList").replaceChildren(...cues.map((cue) => {
    const button = document.createElement("button");
    const time = document.createElement("time"); time.textContent = formatTime(cue.startMs);
    const text = document.createElement("span"); text.textContent = cue.en;
    const ko = document.createElement("small"); ko.textContent = cue.ko;
    button.append(time, text, ko); button.addEventListener("click", () => seek(cue.startMs)); return button;
  }));
}

document.querySelectorAll(".tabs button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tabs button, .tab-panel").forEach((item) => item.classList.remove("active"));
    button.classList.add("active"); $(`#${button.dataset.tab}`).classList.add("active");
  });
});

$("#transcriptSearch").addEventListener("input", (event) => renderTranscript(event.target.value));
$("#subtitleToggle").addEventListener("change", (event) => chrome.runtime.sendMessage({ type: "SET_SUBTITLES", payload: { enabled: event.target.checked } }));

async function enableOnDeviceTranslation(button) {
  button.disabled = true;
  try {
    if (!("Translator" in self)) throw new Error("unavailable");
    const availability = await self.Translator.availability({ sourceLanguage: "ko", targetLanguage: "en" });
    if (availability === "unavailable") throw new Error("unavailable");
    translator = await self.Translator.create({
      sourceLanguage: "ko",
      targetLanguage: "en",
      monitor(monitor) {
        monitor.addEventListener("downloadprogress", (event) => {
          const percent = Math.round((event.loaded || 0) * 100);
          $("#modelStatus").textContent = `Downloading private language model · ${percent}%`;
          button.textContent = `Downloading · ${percent}%`;
        });
      }
    });
    $("#modelStatus").textContent = "Chrome on-device Korean → English is ready · captions stay on this device";
    button.textContent = "Live translation ready";
  } catch {
    $("#modelStatus").textContent = "On-device AI is unavailable here · bundled demo remains active";
    button.textContent = "On-device translation unavailable";
  } finally { button.disabled = false; }
}

$("#localAiButton").addEventListener("click", (event) => enableOnDeviceTranslation(event.currentTarget));
$("#liveAiButton").addEventListener("click", (event) => enableOnDeviceTranslation(event.currentTarget));

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "LIVE_CAPTION" || !translator || !message.payload?.ko) return;
  const payload = message.payload;
  const key = `${payload.videoId}:${payload.timeMs}:${payload.ko}`;
  if (key === lastObservedKey) return;
  lastObservedKey = key;
  translationQueue = translationQueue.then(async () => {
    const en = await translator.translate(payload.ko);
    const cue = { id: `live-${payload.timeMs}`, startMs: payload.timeMs, endMs: payload.timeMs + 6500, ko: payload.ko, en, source: "observed", confidence: 0.7 };
    await chrome.runtime.sendMessage({ type: "RENDER_LIVE_CUE", payload: { videoId: payload.videoId, cue } });
    const live = $("#liveTranslation");
    live.hidden = false;
    live.querySelector("b").textContent = en;
    live.querySelector("span").textContent = payload.ko;
  }).catch(() => {});
});

chrome.runtime.sendMessage({ type: "REQUEST_ACTIVE_VIDEO" }).then((response) => render(response?.localization, response?.context));
