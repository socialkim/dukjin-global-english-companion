import assert from "node:assert/strict";
import test from "node:test";
import { parseJson3Transcript, parseTimedTextXml, selectCaptionTrack } from "../caption-utils.js";

test("prefers a human Korean caption track, then Korean ASR", () => {
  const tracks = [
    { baseUrl: "https://example.com/en", languageCode: "en", name: { simpleText: "English" } },
    { baseUrl: "https://example.com/ko-asr", languageCode: "ko", kind: "asr", name: { simpleText: "Korean (auto-generated)" } },
    { baseUrl: "https://example.com/ko", languageCode: "ko", name: { runs: [{ text: "Korean" }] } }
  ];
  assert.equal(selectCaptionTrack(tracks, "ko").baseUrl, "https://example.com/ko");
  assert.equal(selectCaptionTrack(tracks.slice(0, 2), "ko").baseUrl, "https://example.com/ko-asr");
});

test("parses YouTube json3 events into timestamped cues", () => {
  const cues = parseJson3Transcript({ events: [
    { tStartMs: 1250, dDurationMs: 2750, segs: [{ utf8: "안녕" }, { utf8: " 하세요\n" }] },
    { tStartMs: 4000, segs: [{ utf8: "   " }] }
  ] });
  assert.deepEqual(cues, [{
    id: "track-0-1250",
    startMs: 1250,
    endMs: 4000,
    ko: "안녕 하세요",
    en: "",
    source: "youtube-caption-track"
  }]);
});

test("parses legacy timed-text XML and decodes entities", () => {
  const cues = parseTimedTextXml('<transcript><text start="1.5" dur="2.25">AI &amp; 사람</text></transcript>');
  assert.equal(cues.length, 1);
  assert.equal(cues[0].startMs, 1500);
  assert.equal(cues[0].endMs, 3750);
  assert.equal(cues[0].ko, "AI & 사람");
});
