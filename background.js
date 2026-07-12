const DEMO_CATALOG = {
  YTfathQEoXc: {
    video: {
      id: "YTfathQEoXc",
      titleKo: "GPT-5 출시 준비하는 오픈AI, 왕의 귀환이 임박했습니다",
      titleEn: "OpenAI prepares GPT-5: is the king about to return?",
      publishedAt: "2025-08-04",
      durationMs: 1143000
    },
    transcript: {
      language: "ko",
      complete: false,
      cues: [
        { id: "c1", startMs: 0, endMs: 11000, ko: "오늘은 GPT-5를 준비하는 오픈AI의 이야기를 해보겠습니다.", en: "Today, we're looking at OpenAI as it prepares GPT-5.", source: "mock", confidence: 0.94 },
        { id: "c2", startMs: 11000, endMs: 24000, ko: "시장에서는 다시 한 번 왕의 귀환이 가능할지 주목하고 있습니다.", en: "The market is asking whether the former leader can make a comeback.", source: "mock", confidence: 0.92 },
        { id: "c3", startMs: 24000, endMs: 39000, ko: "하지만 이제 모델 성능 하나만으로 승부가 결정되지는 않습니다.", en: "But model performance alone no longer decides the winner.", source: "mock", confidence: 0.96 },
        { id: "c4", startMs: 39000, endMs: 55000, ko: "비용과 인프라, 그리고 서비스를 얼마나 안정적으로 제공하는지도 중요합니다.", en: "Cost, infrastructure and reliable delivery matter just as much.", source: "mock", confidence: 0.95 },
        { id: "c5", startMs: 55000, endMs: 72000, ko: "구글과 앤스로픽의 추격도 이전과는 비교할 수 없을 만큼 빨라졌습니다.", en: "Google and Anthropic are now closing the gap faster than ever.", source: "mock", confidence: 0.93 },
        { id: "c6", startMs: 72000, endMs: 92000, ko: "결국 사용자가 실제 업무에서 어떤 차이를 느끼는지가 핵심입니다.", en: "What matters is the difference users feel in real work.", source: "mock", confidence: 0.95 },
        { id: "c7", startMs: 92000, endMs: 112000, ko: "출시 전 기대와 출시 후 평가는 분리해서 볼 필요가 있습니다.", en: "Pre-launch expectations must be separated from post-launch reality.", source: "mock", confidence: 0.97 },
        { id: "c8", startMs: 112000, endMs: 132000, ko: "GPT-5는 기술 경쟁뿐 아니라 오픈AI의 사업 지속성을 시험하게 됩니다.", en: "GPT-5 will test OpenAI's business durability as well as its technology.", source: "mock", confidence: 0.91 },
        { id: "c9", startMs: 132000, endMs: 154000, ko: "생태계와 배포력이 모델 점수만큼 중요해지는 시점입니다.", en: "Ecosystem and distribution are becoming as important as benchmark scores.", source: "mock", confidence: 0.94 },
        { id: "c10", startMs: 154000, endMs: 180000, ko: "그래서 저는 왕의 귀환 여부를 실사용 데이터로 판단해야 한다고 봅니다.", en: "That is why the comeback should be judged by real usage data.", source: "mock", confidence: 0.94 }
      ]
    },
    english: {
      summary: {
        tldr: "OpenAI's next model may restore technical momentum, but durable leadership now depends on cost, infrastructure, distribution and real-world value.",
        keyPoints: [
          { text: "Model quality alone no longer guarantees market leadership.", startMs: 24000 },
          { text: "Infrastructure cost and reliable delivery are becoming decisive.", startMs: 39000 },
          { text: "Google and Anthropic have accelerated the competitive cycle.", startMs: 55000 },
          { text: "Post-launch usage is a better test than pre-launch expectations.", startMs: 92000 }
        ],
        chapters: [
          { title: "Why GPT-5 matters", startMs: 0 },
          { title: "The new leadership test", startMs: 24000 },
          { title: "Competition and distribution", startMs: 55000 },
          { title: "What to watch after launch", startMs: 92000 }
        ]
      }
    },
    provenance: {
      transcriptSource: "bundled product demo",
      translationProvider: "editorial demo",
      summaryProvider: "editorial demo",
      generatedAt: "2026-07-12T00:00:00Z",
      reviewed: false
    }
  }
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

async function saveActiveContext(context, tabId) {
  const safe = {
    videoId: String(context.videoId || "").slice(0, 20),
    title: String(context.title || "").slice(0, 300),
    durationMs: Number(context.durationMs) || 0,
    tabId,
    updatedAt: Date.now()
  };
  await chrome.storage.local.set({ activeContext: safe });
  return safe;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") return;

  if (message.type === "VIDEO_CONTEXT_CHANGED") {
    const videoId = String(message.payload?.videoId || "");
    saveActiveContext(message.payload || {}, sender.tab?.id).then(async (context) => {
      const localization = DEMO_CATALOG[videoId] || null;
      if (sender.tab?.id && localization) {
        await chrome.tabs.sendMessage(sender.tab.id, { type: "LOCALIZATION_READY", payload: localization }).catch(() => {});
      }
      sendResponse({ ok: true, context, localization });
    });
    return true;
  }

  if (message.type === "REQUEST_ACTIVE_VIDEO") {
    chrome.storage.local.get("activeContext").then(({ activeContext }) => {
      const localization = activeContext?.videoId ? DEMO_CATALOG[activeContext.videoId] || null : null;
      sendResponse({ context: activeContext || null, localization });
    });
    return true;
  }

  if (message.type === "SEEK_TO") {
    chrome.storage.local.get("activeContext").then(({ activeContext }) => {
      if (activeContext?.tabId) {
        chrome.tabs.sendMessage(activeContext.tabId, { type: "SEEK_TO", payload: { timeMs: Number(message.payload?.timeMs) || 0 } }).catch(() => {});
      }
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === "SET_SUBTITLES") {
    chrome.storage.local.get("activeContext").then(({ activeContext }) => {
      if (activeContext?.tabId) chrome.tabs.sendMessage(activeContext.tabId, message).catch(() => {});
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === "CAPTION_OBSERVED") {
    const latestCaption = { ...message.payload, capturedAt: Date.now() };
    chrome.storage.local.set({ latestCaption });
    chrome.runtime.sendMessage({ type: "LIVE_CAPTION", payload: latestCaption }).catch(() => {});
  }

  if (message.type === "RENDER_LIVE_CUE") {
    chrome.storage.local.get("activeContext").then(({ activeContext }) => {
      if (activeContext?.tabId) chrome.tabs.sendMessage(activeContext.tabId, message).catch(() => {});
      sendResponse({ ok: true });
    });
    return true;
  }
});
