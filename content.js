(() => {
  const state = {
    videoId: "",
    cues: [],
    cueIndex: -1,
    overlay: null,
    text: null,
    badge: null,
    enabled: true,
    captionObserver: null,
    lastCaptionText: ""
  };

  const getVideoId = () => new URL(location.href).searchParams.get("v") || "";

  function parseTimestamp(text) {
    const parts = String(text || "").trim().split(":").map(Number);
    if (!parts.length || parts.some(Number.isNaN)) return null;
    const seconds = parts.reduce((total, value) => total * 60 + value, 0);
    return Math.round(seconds * 1000);
  }

  function ensureOverlay() {
    const player = document.querySelector("#movie_player");
    if (!player) return false;
    if (state.overlay?.isConnected) return true;
    const host = document.createElement("div");
    host.id = "dukjin-global-overlay";
    host.style.cssText = "position:absolute;left:8%;right:8%;bottom:15%;z-index:61;pointer-events:none;display:none;text-align:center";
    const shadow = host.attachShadow({ mode: "closed" });
    const wrap = document.createElement("div");
    wrap.innerHTML = `<style>
      .box{display:inline-block;max-width:980px;background:rgba(5,10,20,.88);color:#fff;padding:10px 17px 12px;border-radius:7px;font:600 20px/1.42 Arial,sans-serif;box-shadow:0 5px 22px rgba(0,0,0,.38)}
      .badge{display:block;color:#9db1ff;font:700 9px/1.2 Arial,sans-serif;letter-spacing:.14em;margin-bottom:5px;text-transform:uppercase}
      @media(max-width:700px){.box{font-size:14px;padding:8px 12px}}
    </style><div class="box"><span class="badge">AI subtitle · Dukjin Global</span><span class="text"></span></div>`;
    shadow.appendChild(wrap);
    state.text = wrap.querySelector(".text");
    state.badge = wrap.querySelector(".badge");
    state.overlay = host;
    player.appendChild(host);
    return true;
  }

  function findCueIndex(timeMs) {
    let low = 0;
    let high = state.cues.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const cue = state.cues[middle];
      if (timeMs < cue.startMs) high = middle - 1;
      else if (timeMs >= cue.endMs) low = middle + 1;
      else return middle;
    }
    return -1;
  }

  function renderFrame() {
    const video = document.querySelector("video");
    if (!video || !ensureOverlay()) {
      setTimeout(renderFrame, 500);
      return;
    }
    const player = document.querySelector("#movie_player");
    if (!state.enabled || player?.classList.contains("ad-showing")) {
      state.overlay.style.display = "none";
    } else {
      const index = findCueIndex(video.currentTime * 1000);
      if (index !== state.cueIndex) {
        state.cueIndex = index;
        const cue = state.cues[index];
        if (cue?.en) {
          state.text.textContent = cue.en;
          state.overlay.style.display = "block";
        } else {
          state.overlay.style.display = "none";
        }
      }
    }
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(renderFrame);
    else requestAnimationFrame(renderFrame);
  }

  function connectCaptionObserver() {
    const player = document.querySelector("#movie_player");
    if (!player) return;
    state.captionObserver?.disconnect();
    state.captionObserver = new MutationObserver(() => {
      const text = [...document.querySelectorAll(".ytp-caption-segment")].map((node) => node.textContent).join(" ").replace(/\s+/g, " ").trim();
      if (!text || text === state.lastCaptionText || !/[가-힣]/.test(text)) return;
      state.lastCaptionText = text;
      const video = document.querySelector("video");
      chrome.runtime.sendMessage({
        type: "CAPTION_OBSERVED",
        payload: { videoId: state.videoId, ko: text.slice(0, 500), timeMs: Math.round((video?.currentTime || 0) * 1000) }
      });
    });
    state.captionObserver.observe(player, { subtree: true, childList: true, characterData: true });
  }

  function collectTranscriptRows() {
    const primary = [...document.querySelectorAll("ytd-transcript-segment-renderer, transcript-segment-view-model")];
    if (primary.length) return primary;
    return [...document.querySelectorAll("ytd-transcript-segment-list-renderer [role='button']")].filter((row) => /\d{1,2}:\d{2}/.test(row.textContent || ""));
  }

  function captureTranscript() {
    const rows = collectTranscriptRows();
    const provisional = rows.map((row, index) => {
      const timestampElement = row.querySelector(".segment-timestamp, .ytwTranscriptSegmentViewModelTimestamp, [class*='timestamp']");
      const textElement = row.querySelector("yt-formatted-string.segment-text, .segment-text, .ytwTranscriptSegmentViewModelText, [class*='segment-text']");
      const fullText = (row.textContent || "").replace(/\s+/g, " ").trim();
      const timestampText = (timestampElement?.textContent || fullText.match(/\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b/)?.[0] || "").trim();
      const startMs = parseTimestamp(timestampText);
      let ko = (textElement?.textContent || fullText.replace(timestampText, "")).replace(/\s+/g, " ").trim();
      ko = ko.replace(/^\s*[·•]\s*/, "").slice(0, 1000);
      if (startMs === null || !ko) return null;
      return { id: `yt-${index}-${startMs}`, startMs, ko, source: "youtube-transcript-panel" };
    }).filter(Boolean);

    const seen = new Set();
    const unique = provisional.filter((cue) => {
      const key = `${cue.startMs}:${cue.ko}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => a.startMs - b.startMs);

    const cues = unique.map((cue, index) => ({
      ...cue,
      endMs: Math.max(cue.startMs + 800, Math.min(unique[index + 1]?.startMs || cue.startMs + 6500, cue.startMs + 12000))
    }));
    return { ok: cues.length > 0, cues, count: cues.length, reason: cues.length ? null : "transcript-panel-not-open" };
  }

  async function updateContext() {
    const videoId = getVideoId();
    if (!videoId || videoId === state.videoId) return;
    state.videoId = videoId;
    state.cues = [];
    state.cueIndex = -1;
    state.lastCaptionText = "";
    if (state.overlay) state.overlay.style.display = "none";
    const video = document.querySelector("video");
    const response = await chrome.runtime.sendMessage({
      type: "VIDEO_CONTEXT_CHANGED",
      payload: { videoId, title: document.title.replace(" - YouTube", ""), durationMs: Math.round((video?.duration || 0) * 1000) }
    }).catch(() => null);
    if (response?.localization) applyLocalization(response.localization);
    setTimeout(connectCaptionObserver, 500);
  }

  function applyLocalization(localization) {
    if (localization?.video?.id !== state.videoId) return;
    state.cues = [...(localization.transcript?.cues || [])].sort((a, b) => a.startMs - b.startMs);
    state.cueIndex = -1;
    if (state.badge) {
      const language = localization.english?.language || "AI";
      state.badge.textContent = localization.provenance?.reviewed ? `${language} · Creator reviewed` : `${language} · AI generated`;
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "LOCALIZATION_READY") applyLocalization(message.payload);
    if (message?.type === "SEEK_TO") {
      const video = document.querySelector("video");
      if (video) {
        video.currentTime = Math.max(0, Number(message.payload?.timeMs || 0) / 1000);
        video.play().catch(() => {});
      }
    }
    if (message?.type === "SET_SUBTITLES") {
      state.enabled = Boolean(message.payload?.enabled);
      state.cueIndex = -1;
      if (!state.enabled && state.overlay) state.overlay.style.display = "none";
    }
    if (message?.type === "RENDER_LIVE_CUE" && message.payload?.videoId === state.videoId) {
      const cue = message.payload.cue;
      state.cues = [...state.cues.filter((item) => item.id !== cue.id), cue].sort((a, b) => a.startMs - b.startMs).slice(-500);
      state.cueIndex = -1;
      if (state.badge) state.badge.textContent = "On-device · Live";
    }
    if (message?.type === "CAPTURE_TRANSCRIPT") {
      sendResponse(captureTranscript());
      return true;
    }
  });

  document.addEventListener("yt-navigate-finish", updateContext);
  new MutationObserver(updateContext).observe(document.documentElement, { subtree: true, childList: true });
  setTimeout(() => {
    updateContext();
    ensureOverlay();
    connectCaptionObserver();
    renderFrame();
  }, 900);
})();
