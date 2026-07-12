const MAX_CUES = 5000;

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

function cleanText(value, max = 1000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanCue(cue, index = 0) {
  const startMs = Math.max(0, Math.round(Number(cue?.startMs) || 0));
  const endMs = Math.max(startMs + 500, Math.round(Number(cue?.endMs) || startMs + 5000));
  return {
    id: cleanText(cue?.id, 80) || `cue-${index}-${startMs}`,
    startMs,
    endMs,
    ko: cleanText(cue?.ko),
    en: cleanText(cue?.en),
    source: cleanText(cue?.source, 40) || "youtube-dom"
  };
}

async function getActiveContext() {
  const { activeContext } = await chrome.storage.local.get("activeContext");
  return activeContext || null;
}

async function saveActiveContext(payload, tabId) {
  const context = {
    videoId: cleanText(payload?.videoId, 20),
    title: cleanText(payload?.title, 300),
    durationMs: Math.max(0, Math.round(Number(payload?.durationMs) || 0)),
    tabId,
    updatedAt: Date.now()
  };
  await chrome.storage.local.set({ activeContext: context });
  return context;
}

async function getLocalization(videoId) {
  if (!videoId) return null;
  const key = `localization:${videoId}`;
  const result = await chrome.storage.local.get(key);
  return result[key] || null;
}

async function appendLiveCue(payload) {
  const videoId = cleanText(payload?.videoId, 20);
  const ko = cleanText(payload?.ko, 500);
  if (!videoId || !ko) return;
  const key = `liveTranscript:${videoId}`;
  const result = await chrome.storage.local.get(key);
  const cues = Array.isArray(result[key]) ? result[key] : [];
  const previous = cues.at(-1);
  const startMs = Math.max(0, Math.round(Number(payload?.timeMs) || 0));
  if (previous?.ko === ko && startMs - previous.startMs < 8000) return;
  cues.push(cleanCue({ id: `live-${startMs}`, startMs, endMs: startMs + 6500, ko, source: "youtube-live" }, cues.length));
  await chrome.storage.local.set({ [key]: cues.slice(-MAX_CUES) });
}

async function requestTranscriptFromPage(tabId) {
  if (!tabId) return { ok: false, reason: "no-active-youtube-tab", cues: [] };
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "CAPTURE_TRANSCRIPT" });
  } catch {
    return { ok: false, reason: "content-script-unavailable", cues: [] };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") return;

  if (message.type === "VIDEO_CONTEXT_CHANGED") {
    saveActiveContext(message.payload, sender.tab?.id).then(async (context) => {
      const localization = await getLocalization(context.videoId);
      if (localization && sender.tab?.id) {
        await chrome.tabs.sendMessage(sender.tab.id, { type: "LOCALIZATION_READY", payload: localization }).catch(() => {});
      }
      sendResponse({ ok: true, context, localization });
    });
    return true;
  }

  if (message.type === "REQUEST_ACTIVE_VIDEO") {
    getActiveContext().then(async (context) => {
      sendResponse({ context, localization: await getLocalization(context?.videoId) });
    });
    return true;
  }

  if (message.type === "REQUEST_TRANSCRIPT") {
    getActiveContext().then(async (context) => {
      const pageResult = await requestTranscriptFromPage(context?.tabId);
      if (pageResult?.cues?.length) {
        sendResponse({ ...pageResult, context, source: "youtube-transcript-panel" });
        return;
      }
      const key = `liveTranscript:${context?.videoId || ""}`;
      const stored = await chrome.storage.local.get(key);
      const liveCues = Array.isArray(stored[key]) ? stored[key] : [];
      sendResponse({ ok: liveCues.length > 0, context, cues: liveCues, source: "watched-live-captions", reason: pageResult?.reason || "transcript-panel-not-open" });
    });
    return true;
  }

  if (message.type === "PUBLISH_LOCALIZATION") {
    getActiveContext().then(async (context) => {
      const payload = message.payload;
      if (!payload?.video?.id || payload.video.id !== context?.videoId) {
        sendResponse({ ok: false, reason: "video-context-mismatch" });
        return;
      }
      const cues = (payload.transcript?.cues || []).slice(0, MAX_CUES).map(cleanCue).filter((cue) => cue.ko || cue.en);
      const localization = { ...payload, transcript: { ...payload.transcript, cues } };
      await chrome.storage.local.set({ [`localization:${context.videoId}`]: localization });
      if (context.tabId) await chrome.tabs.sendMessage(context.tabId, { type: "LOCALIZATION_READY", payload: localization }).catch(() => {});
      sendResponse({ ok: true, cueCount: cues.length });
    });
    return true;
  }

  if (message.type === "SEEK_TO" || message.type === "SET_SUBTITLES" || message.type === "RENDER_LIVE_CUE") {
    getActiveContext().then(async (context) => {
      if (context?.tabId) await chrome.tabs.sendMessage(context.tabId, message).catch(() => {});
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === "CAPTION_OBSERVED") {
    const latestCaption = { ...message.payload, capturedAt: Date.now() };
    appendLiveCue(latestCaption);
    chrome.storage.local.set({ latestCaption });
    chrome.runtime.sendMessage({ type: "LIVE_CAPTION", payload: latestCaption }).catch(() => {});
  }

  if (message.type === "CLEAR_VIDEO_DATA") {
    getActiveContext().then(async (context) => {
      if (context?.videoId) await chrome.storage.local.remove([`localization:${context.videoId}`, `liveTranscript:${context.videoId}`]);
      sendResponse({ ok: true });
    });
    return true;
  }
});
