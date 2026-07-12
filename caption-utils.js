const DEFAULT_DURATION_MS = 5000;

function cleanInlineText(value) {
  return String(value || "").replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
}

function trackLabel(track) {
  return cleanInlineText(
    track?.name?.simpleText
      || track?.name?.runs?.map((run) => run?.text || "").join("")
      || track?.label
      || track?.languageCode
  );
}

export function normalizeCaptionTrack(track) {
  if (!track?.baseUrl) return null;
  return {
    baseUrl: String(track.baseUrl),
    languageCode: cleanInlineText(track.languageCode).toLowerCase(),
    label: trackLabel(track),
    kind: cleanInlineText(track.kind).toLowerCase(),
    vssId: cleanInlineText(track.vssId),
    isTranslatable: Boolean(track.isTranslatable)
  };
}

export function selectCaptionTrack(tracks, preferredLanguage = "ko") {
  const normalized = (Array.isArray(tracks) ? tracks : []).map(normalizeCaptionTrack).filter(Boolean);
  if (!normalized.length) return null;
  const preferred = cleanInlineText(preferredLanguage).toLowerCase() || "ko";
  const score = (track) => {
    const language = track.languageCode;
    const exact = language === preferred;
    const family = language.startsWith(`${preferred}-`) || preferred.startsWith(`${language}-`);
    return (exact ? 100 : family ? 80 : 0) + (track.kind !== "asr" ? 10 : 0);
  };
  return normalized.toSorted((a, b) => score(b) - score(a))[0];
}

export function parseJson3Transcript(payload) {
  const events = Array.isArray(payload?.events) ? payload.events : [];
  return events.flatMap((event, index) => {
    const text = cleanInlineText((event?.segs || []).map((segment) => segment?.utf8 || "").join(""));
    if (!text) return [];
    const startMs = Math.max(0, Math.round(Number(event?.tStartMs) || 0));
    const durationMs = Math.max(250, Math.round(Number(event?.dDurationMs) || DEFAULT_DURATION_MS));
    return [{ id: `track-${index}-${startMs}`, startMs, endMs: startMs + durationMs, ko: text, en: "", source: "youtube-caption-track" }];
  });
}

function decodeXml(value) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return String(value || "").replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const hex = entity[1]?.toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

export function parseTimedTextXml(xml) {
  const entries = [];
  const pattern = /<(text|p)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = pattern.exec(String(xml || "")))) {
    const attrs = match[2];
    const getAttr = (name) => attrs.match(new RegExp(`\\b${name}="([^"]+)"`, "i"))?.[1];
    const usesMs = match[1].toLowerCase() === "p";
    const start = Number(getAttr(usesMs ? "t" : "start")) || 0;
    const duration = Number(getAttr(usesMs ? "d" : "dur")) || (usesMs ? DEFAULT_DURATION_MS : DEFAULT_DURATION_MS / 1000);
    const startMs = Math.max(0, Math.round(usesMs ? start : start * 1000));
    const durationMs = Math.max(250, Math.round(usesMs ? duration : duration * 1000));
    const content = match[3].replace(/<br\s*\/?\s*>/gi, " ").replace(/<[^>]+>/g, "");
    const cueText = cleanInlineText(decodeXml(content));
    if (cueText) entries.push({ id: `track-${entries.length}-${startMs}`, startMs, endMs: startMs + durationMs, ko: cueText, en: "", source: "youtube-caption-track" });
  }
  return entries;
}
