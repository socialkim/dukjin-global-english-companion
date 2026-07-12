import { parseJson3Transcript, parseTimedTextXml, selectCaptionTrack } from "./caption-utils.js";

const MAX_CUES = 5000;

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.storage.local.get("subtitlesEnabled").then(({ subtitlesEnabled }) => {
    if (typeof subtitlesEnabled !== "boolean") chrome.storage.local.set({ subtitlesEnabled: true });
  });
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
    const existing = await chrome.tabs.sendMessage(tabId, { type: "CAPTURE_TRANSCRIPT" });
    if (existing?.cues?.length) return { ...existing, autoOpened: false };

    const [{ result: opened } = {}] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: async () => {
        const segmentSelector = [
          "ytd-transcript-segment-renderer",
          "transcript-segment-view-model",
          "[class*='TranscriptSegmentViewModel'][role='button']",
          "[class*='transcript-segment'][role='button']"
        ].join(",");
        if (document.querySelector(segmentSelector)) return true;

        const expand = document.querySelector("ytd-text-inline-expander #expand, #description #expand");
        if (expand instanceof HTMLElement) expand.click();
        await new Promise((resolve) => setTimeout(resolve, 250));

        const transcriptButton = document.querySelector(
          "ytd-video-description-transcript-section-renderer button, button[aria-label='Show transcript']"
        );
        if (!(transcriptButton instanceof HTMLElement)) return false;
        transcriptButton.click();

        const deadline = Date.now() + 6000;
        while (Date.now() < deadline) {
          if (document.querySelector(segmentSelector)) return true;
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        return false;
      }
    });
    if (!opened) return existing;
    const captured = await chrome.tabs.sendMessage(tabId, { type: "CAPTURE_TRANSCRIPT" });
    return { ...captured, autoOpened: Boolean(captured?.cues?.length) };
  } catch {
    return { ok: false, reason: "content-script-unavailable", cues: [] };
  }
}

async function readCaptionTracks(tabId) {
  if (!tabId) return [];
  try {
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        const parse = (value) => {
          if (!value) return null;
          if (typeof value === "object") return value;
          try { return JSON.parse(value); } catch { return null; }
        };
        const player = document.getElementById("movie_player");
        const candidates = [
          player?.getPlayerResponse?.(),
          window.ytInitialPlayerResponse,
          parse(window.ytplayer?.config?.args?.player_response)
        ];
        for (const response of candidates) {
          const tracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
          if (Array.isArray(tracks) && tracks.length) {
            return tracks.map((track) => ({
              baseUrl: track.baseUrl,
              languageCode: track.languageCode,
              kind: track.kind || "",
              vssId: track.vssId || "",
              isTranslatable: Boolean(track.isTranslatable),
              name: track.name || null
            }));
          }
        }
        return [];
      }
    });
    return Array.isArray(result) ? result : [];
  } catch {
    return [];
  }
}

async function downloadCaptionTrack(track) {
  const jsonUrl = new URL(track.baseUrl);
  jsonUrl.searchParams.set("fmt", "json3");
  try {
    const response = await fetch(jsonUrl, { credentials: "include", cache: "no-store" });
    if (!response.ok) throw new Error(`caption-http-${response.status}`);
    const cues = parseJson3Transcript(await response.json());
    if (cues.length) return cues;
  } catch {
    // Older or restricted tracks can still expose the timed-text XML representation.
  }
  const xmlUrl = new URL(track.baseUrl);
  xmlUrl.searchParams.delete("fmt");
  const response = await fetch(xmlUrl, { credentials: "include", cache: "no-store" });
  if (!response.ok) throw new Error(`caption-http-${response.status}`);
  return parseTimedTextXml(await response.text());
}

async function requestInstantTranscript(context, preferredLanguage = "ko") {
  if (!context?.tabId) return { ok: false, reason: "no-active-youtube-tab", cues: [] };
  const tracks = await readCaptionTracks(context.tabId);
  if (!tracks.length) return { ok: false, reason: "youtube-caption-track-not-found", cues: [] };
  const track = selectCaptionTrack(tracks, preferredLanguage);
  if (!track) return { ok: false, reason: "preferred-caption-track-not-found", cues: [] };
  try {
    const cues = (await downloadCaptionTrack(track)).slice(0, MAX_CUES).map(cleanCue).filter((cue) => cue.ko);
    return {
      ok: cues.length > 0,
      cues,
      reason: cues.length ? "" : "youtube-caption-track-empty",
      source: "youtube-caption-track",
      instant: true,
      track: { languageCode: track.languageCode, label: track.label, kind: track.kind || "manual" }
    };
  } catch (error) {
    return { ok: false, reason: cleanText(error?.message, 120) || "youtube-caption-download-failed", cues: [] };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") return;

  if (message.type === "VIDEO_CONTEXT_CHANGED") {
    saveActiveContext(message.payload, sender.tab?.id).then(async (context) => {
      const localization = await getLocalization(context.videoId);
      const { subtitlesEnabled = true } = await chrome.storage.local.get("subtitlesEnabled");
      if (localization && sender.tab?.id) {
        await chrome.tabs.sendMessage(sender.tab.id, { type: "LOCALIZATION_READY", payload: localization }).catch(() => {});
      }
      if (sender.tab?.id) {
        await chrome.tabs.sendMessage(sender.tab.id, { type: "SET_SUBTITLES", payload: { enabled: subtitlesEnabled } }).catch(() => {});
      }
      sendResponse({ ok: true, context, localization, subtitlesEnabled });
    });
    return true;
  }

  if (message.type === "REQUEST_ACTIVE_VIDEO") {
    getActiveContext().then(async (context) => {
      const { subtitlesEnabled = true } = await chrome.storage.local.get("subtitlesEnabled");
      sendResponse({ context, localization: await getLocalization(context?.videoId), subtitlesEnabled });
    });
    return true;
  }

  if (message.type === "REQUEST_TRANSCRIPT") {
    getActiveContext().then(async (context) => {
      const instantResult = await requestInstantTranscript(context, message.payload?.preferredLanguage || "ko");
      if (instantResult.cues?.length) {
        sendResponse({ ...instantResult, context });
        return;
      }
      const pageResult = await requestTranscriptFromPage(context?.tabId);
      if (pageResult?.cues?.length) {
        sendResponse({
          ...pageResult,
          context,
          source: pageResult.autoOpened ? "youtube-transcript-panel-auto" : "youtube-transcript-panel",
          instant: Boolean(pageResult.autoOpened),
          track: pageResult.autoOpened ? { languageCode: "ko", label: "YouTube transcript", kind: "panel" } : undefined
        });
        return;
      }
      const key = `liveTranscript:${context?.videoId || ""}`;
      const stored = await chrome.storage.local.get(key);
      const liveCues = Array.isArray(stored[key]) ? stored[key] : [];
      sendResponse({
        ok: liveCues.length > 0,
        context,
        cues: liveCues,
        source: "watched-live-captions",
        reason: pageResult?.reason || instantResult.reason || "transcript-panel-not-open"
      });
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

  if (message.type === "SET_SUBTITLES") {
    const enabled = Boolean(message.payload?.enabled);
    chrome.storage.local.set({ subtitlesEnabled: enabled }).then(async () => {
      const context = await getActiveContext();
      let delivered = false;
      if (context?.tabId) {
        delivered = await chrome.tabs.sendMessage(context.tabId, { type: "SET_SUBTITLES", payload: { enabled } })
          .then(() => true)
          .catch(() => false);
      }
      sendResponse({ ok: true, enabled, delivered });
    });
    return true;
  }

  if (message.type === "SEEK_TO" || message.type === "RENDER_LIVE_CUE") {
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
