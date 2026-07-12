const COPY = {
  reportSuffix: "온디바이스 빠른 브리프",
  subtitle: "캡처된 자막에서 로컬로 구성한 추출형 요약",
  keyMessage: "핵심 장면과 원문 타임스탬프를 먼저 확인하세요.",
  transcript: "자막",
  coverage: "범위",
  privacy: "처리",
  cues: "개 구간",
  localOnly: "기기 내",
  transcriptDetail: "캡처하여 처리한 자막 구간 수",
  coverageDetail: "마지막으로 반영된 영상 시점",
  privacyDetail: "이 빠른 브리프에는 외부 AI API를 사용하지 않음",
  story: "방송 흐름",
  takeaway: "핵심 장면",
  executive: "전체 자막에서 시간대별 대표 장면을 골라 만든 빠른 브리프입니다.",
  section: "구간",
  recommendations: ["원본 영상의 해당 타임스탬프를 확인하세요.", "중요한 이름과 숫자는 자동 자막과 대조하세요.", "더 정교한 종합 분석은 OpenAI API 모드를 사용하세요."],
  caveats: ["추출형 요약으로 문맥과 뉘앙스가 생략될 수 있습니다.", "자동 자막의 인식 오류가 그대로 반영될 수 있습니다."],
  footer: "Dukjin Global · 온디바이스 생성 · 원본 영상 확인 필요"
};

export const LANGUAGE_CODES = Object.freeze({
  Korean: "ko",
  English: "en",
  Japanese: "ja",
  "Chinese (Simplified)": "zh",
  Spanish: "es",
  French: "fr",
  German: "de",
  Portuguese: "pt"
});

export function languageCode(language) {
  return LANGUAGE_CODES[language] || "en";
}

function clean(value, max = 420) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function formatTimestamp(ms) {
  const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function chooseRepresentativeCues(cues, count = 4) {
  const usable = (cues || []).filter((cue) => clean(cue.en || cue.ko));
  if (!usable.length) return [];
  if (usable.length <= count) return usable;
  const selected = [];
  const seen = new Set();
  for (let index = 0; index < count; index += 1) {
    const position = Math.round((index * (usable.length - 1)) / Math.max(1, count - 1));
    const cue = usable[position];
    if (!seen.has(cue.id)) { selected.push(cue); seen.add(cue.id); }
  }
  return selected;
}

function cueText(cue) {
  return clean(cue?.en || cue?.ko || "", 360);
}

function nearbyBody(cues, cue) {
  const index = Math.max(0, cues.findIndex((item) => item.id === cue.id));
  return cues.slice(index, index + 3).map(cueText).filter(Boolean).join(" ").slice(0, 760);
}

export function buildLocalPublishingPack({ title, cues }) {
  const source = (cues || []).filter((cue) => clean(cue.en || cue.ko));
  if (!source.length) throw new Error("A captured transcript is required for an on-device brief.");
  const timeline = chooseRepresentativeCues(source, 4);
  while (timeline.length < 4) timeline.push(timeline.at(-1));
  const takeaways = chooseRepresentativeCues(source, 3);
  while (takeaways.length < 3) takeaways.push(takeaways.at(-1));
  const duration = Math.max(...source.map((cue) => Number(cue.endMs || cue.startMs || 0)));
  const safeTitle = clean(title, 180) || "YouTube video";

  return {
    infographic: {
      title: safeTitle,
      subtitle: COPY.subtitle,
      keyMessage: cueText(timeline[0]),
      facts: [
        { label: COPY.transcript, value: `${source.length}${COPY.cues}`, detail: COPY.transcriptDetail, startMs: 0 },
        { label: COPY.coverage, value: formatTimestamp(duration), detail: COPY.coverageDetail, startMs: duration },
        { label: COPY.privacy, value: COPY.localOnly, detail: COPY.privacyDetail, startMs: 0 }
      ],
      timeline: timeline.map((cue, index) => ({ title: `${COPY.story} ${index + 1}`, detail: cueText(cue), startMs: cue.startMs })),
      takeaways: takeaways.map((cue) => ({ text: cueText(cue), startMs: cue.startMs })),
      footer: COPY.footer
    },
    report: {
      title: `${safeTitle} — ${COPY.reportSuffix}`,
      subtitle: COPY.subtitle,
      executiveSummary: `${COPY.executive} ${cueText(timeline[0])}`,
      sections: timeline.map((cue, index) => ({
        heading: `${COPY.section} ${index + 1} · ${formatTimestamp(cue.startMs)}`,
        body: nearbyBody(source, cue),
        evidence: [{ text: cueText(cue), startMs: cue.startMs }]
      })),
      recommendations: [...COPY.recommendations],
      caveats: [...COPY.caveats]
    }
  };
}

export function analysisFromLocalPack(pack) {
  return {
    title: pack.infographic.title,
    tldr: pack.report.executiveSummary,
    keyPoints: pack.infographic.takeaways.map((item) => ({ text: item.text, startMs: item.startMs })),
    chapters: pack.infographic.timeline.map((item) => ({ title: item.title, startMs: item.startMs })),
    glossary: []
  };
}

export async function translateObjectStrings(value, translate) {
  if (typeof value === "string") return translate(value);
  if (Array.isArray(value)) {
    const output = [];
    for (const item of value) output.push(await translateObjectStrings(item, translate));
    return output;
  }
  if (value && typeof value === "object") {
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = ["startMs"].includes(key) ? item : await translateObjectStrings(item, translate);
    }
    return output;
  }
  return value;
}
