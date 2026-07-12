(() => {
  const state = { videoId: "", cues: [], cueIndex: -1, overlay: null, text: null, badge: null, frameHandle: null, enabled: true };

  const getVideoId = () => new URL(location.href).searchParams.get("v") || "";

  function ensureOverlay() {
    const player = document.querySelector("#movie_player");
    if (!player) return false;
    if (state.overlay?.isConnected) return true;

    const host = document.createElement("div");
    host.id = "dukjin-global-overlay";
    host.style.cssText = "position:absolute;left:10%;right:10%;bottom:15%;z-index:61;pointer-events:none;display:none;text-align:center";
    const shadow = host.attachShadow({ mode: "closed" });
    const wrap = document.createElement("div");
    wrap.innerHTML = `<style>
      .box{display:inline-block;max-width:900px;background:rgba(5,10,20,.84);color:#fff;padding:10px 16px 12px;border-radius:6px;font:600 20px/1.4 Arial,sans-serif;box-shadow:0 5px 22px rgba(0,0,0,.35)}
      .badge{display:block;color:#9db1ff;font:700 9px/1.2 Arial,sans-serif;letter-spacing:.14em;margin-bottom:5px;text-transform:uppercase}
      @media(max-width:700px){.box{font-size:14px;padding:8px 12px}}
    </style><div class="box"><span class="badge">English · Dukjin Global</span><span class="text"></span></div>`;
    shadow.appendChild(wrap);
    state.text = wrap.querySelector(".text");
    state.badge = wrap.querySelector(".badge");
    state.overlay = host;
    player.appendChild(host);
    return true;
  }

  function findCueIndex(timeMs) {
    let low = 0, high = state.cues.length - 1;
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
    if (!video || !ensureOverlay()) return;
    const player = document.querySelector("#movie_player");
    if (player?.classList.contains("ad-showing")) {
      state.overlay.style.display = "none";
    } else {
      const index = findCueIndex(video.currentTime * 1000);
      if (!state.enabled) {
        state.overlay.style.display = "none";
      } else if (index !== state.cueIndex) {
        state.cueIndex = index;
        if (index >= 0) {
          state.text.textContent = state.cues[index].en;
          state.overlay.style.display = "block";
        } else {
          state.overlay.style.display = "none";
        }
      }
    }
    state.frameHandle = video.requestVideoFrameCallback ? video.requestVideoFrameCallback(renderFrame) : requestAnimationFrame(renderFrame);
  }

  function observeNativeCaptions() {
    const root = document.querySelector("#movie_player");
    if (!root) return;
    const observer = new MutationObserver(() => {
      const text = [...document.querySelectorAll(".ytp-caption-segment")].map((node) => node.textContent).join(" ").trim();
      if (text && /[가-힣]/.test(text)) {
        const video = document.querySelector("video");
        chrome.runtime.sendMessage({ type: "CAPTION_OBSERVED", payload: { videoId: state.videoId, ko: text.slice(0, 500), timeMs: Math.round((video?.currentTime || 0) * 1000) } });
      }
    });
    observer.observe(root, { subtree: true, childList: true, characterData: true });
  }

  async function updateContext() {
    const videoId = getVideoId();
    if (!videoId || videoId === state.videoId) return;
    state.videoId = videoId;
    state.cues = [];
    state.cueIndex = -1;
    if (state.overlay) state.overlay.style.display = "none";
    const video = document.querySelector("video");
    const response = await chrome.runtime.sendMessage({
      type: "VIDEO_CONTEXT_CHANGED",
      payload: { videoId, title: document.title.replace(" - YouTube", ""), durationMs: Math.round((video?.duration || 0) * 1000) }
    }).catch(() => null);
    if (response?.localization) applyLocalization(response.localization);
  }

  function applyLocalization(localization) {
    if (localization?.video?.id !== state.videoId) return;
    state.cues = [...(localization.transcript?.cues || [])].sort((a, b) => a.startMs - b.startMs);
    if (state.badge) state.badge.textContent = localization.provenance?.reviewed ? "English · Creator reviewed" : "English · Product demo";
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "LOCALIZATION_READY") applyLocalization(message.payload);
    if (message?.type === "SEEK_TO") {
      const video = document.querySelector("video");
      if (video) { video.currentTime = Math.max(0, Number(message.payload?.timeMs || 0) / 1000); video.play().catch(() => {}); }
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
      if (state.badge) state.badge.textContent = "English · On-device live";
    }
  });

  document.addEventListener("yt-navigate-finish", updateContext);
  const routeObserver = new MutationObserver(updateContext);
  routeObserver.observe(document.documentElement, { subtree: true, childList: true });
  setTimeout(() => { updateContext(); ensureOverlay(); observeNativeCaptions(); renderFrame(); }, 900);
})();
