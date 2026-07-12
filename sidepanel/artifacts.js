function safe(value) {
  return String(value ?? "").trim();
}

const LABELS = {
  English: { executive: "Executive summary", evidence: "Evidence", recommendations: "Recommendations", caveats: "Caveats", timeline: "The story in four moves", takeaways: "Takeaways", source: "Source", generated: "AI-generated · Verify names, numbers and claims against the source video." },
  Korean: { executive: "핵심 요약", evidence: "근거", recommendations: "활용 제안", caveats: "주의사항", timeline: "네 단계로 보는 핵심 흐름", takeaways: "핵심 포인트", source: "원본", generated: "AI 생성 · 인명, 숫자와 주요 주장은 원본 영상에서 확인하세요." },
  Japanese: { executive: "エグゼクティブサマリー", evidence: "根拠", recommendations: "提案", caveats: "注意事項", timeline: "4つの流れ", takeaways: "要点", source: "出典", generated: "AI生成 · 人名、数字、重要な主張は元動画で確認してください。" },
  "Chinese (Simplified)": { executive: "执行摘要", evidence: "依据", recommendations: "建议", caveats: "注意事项", timeline: "四步看懂核心脉络", takeaways: "核心要点", source: "来源", generated: "AI生成 · 请对照原视频核实人名、数字和重要观点。" },
  Spanish: { executive: "Resumen ejecutivo", evidence: "Evidencia", recommendations: "Recomendaciones", caveats: "Advertencias", timeline: "La historia en cuatro pasos", takeaways: "Conclusiones", source: "Fuente", generated: "Generado por IA · Verifica nombres, cifras y afirmaciones con el video original." },
  French: { executive: "Résumé exécutif", evidence: "Éléments de preuve", recommendations: "Recommandations", caveats: "Réserves", timeline: "L’histoire en quatre étapes", takeaways: "À retenir", source: "Source", generated: "Généré par IA · Vérifiez les noms, chiffres et affirmations dans la vidéo source." },
  German: { executive: "Zusammenfassung", evidence: "Belege", recommendations: "Empfehlungen", caveats: "Hinweise", timeline: "Die Geschichte in vier Schritten", takeaways: "Kernaussagen", source: "Quelle", generated: "KI-generiert · Namen, Zahlen und Aussagen im Originalvideo prüfen." },
  Portuguese: { executive: "Resumo executivo", evidence: "Evidências", recommendations: "Recomendações", caveats: "Ressalvas", timeline: "A história em quatro etapas", takeaways: "Principais conclusões", source: "Fonte", generated: "Gerado por IA · Confira nomes, números e afirmações no vídeo original." }
};

function labelsFor(language) { return LABELS[language] || LABELS.English; }
export function artifactLabels(language) { return { ...labelsFor(language) }; }
function languageCode(language) { return ({ Korean: "ko", English: "en", Japanese: "ja", "Chinese (Simplified)": "zh-CN", Spanish: "es", French: "fr", German: "de", Portuguese: "pt" })[language] || "en"; }

export function formatTimestamp(ms) {
  const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function slugify(value) {
  return safe(value).normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 70) || "youtube-report";
}

function markdownList(items = []) {
  return items.map((item) => `- ${safe(item)}`).join("\n");
}

export function buildReportMarkdown(pack, video, language) {
  const report = pack.report;
  const labels = labelsFor(language);
  const sections = (report.sections || []).map((section) => {
    const evidence = (section.evidence || []).map((item) => `- [${formatTimestamp(item.startMs)}](https://youtu.be/${video.id}?t=${Math.floor(item.startMs / 1000)}) ${safe(item.text)}`).join("\n");
    return `## ${safe(section.heading)}\n\n${safe(section.body)}\n\n### ${labels.evidence}\n\n${evidence}`;
  }).join("\n\n");
  return [
    `# ${safe(report.title)}`,
    safe(report.subtitle),
    `> ${labels.source}: [${safe(video.title)}](https://youtu.be/${video.id}) · ${language} · AI-generated`,
    `## ${labels.executive}`,
    safe(report.executiveSummary),
    sections,
    `## ${labels.recommendations}`,
    markdownList(report.recommendations),
    `## ${labels.caveats}`,
    markdownList(report.caveats),
    `---\nDukjin Global · Built with Codex · ${labels.generated}`
  ].join("\n\n");
}

function escapeHtml(value) {
  return safe(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

export function buildReportHtml(pack, video, language) {
  const report = pack.report;
  const labels = labelsFor(language);
  const sections = (report.sections || []).map((section) => `<section><h2>${escapeHtml(section.heading)}</h2><p>${escapeHtml(section.body)}</p><ul>${(section.evidence || []).map((item) => `<li><a href="https://youtu.be/${encodeURIComponent(video.id)}?t=${Math.floor(item.startMs / 1000)}">${formatTimestamp(item.startMs)}</a> ${escapeHtml(item.text)}</li>`).join("")}</ul></section>`).join("");
  return `<!doctype html><html lang="${languageCode(language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(report.title)}</title><style>body{max-width:820px;margin:0 auto;padding:64px 28px;color:#101827;background:#f4f0e7;font:16px/1.75 Arial,sans-serif}h1{font-size:44px;line-height:1.08;letter-spacing:-.04em}h2{margin-top:46px;border-top:2px solid #101827;padding-top:14px}header{border-bottom:8px solid #2457ff;padding-bottom:28px}.meta{color:#667085;font-size:13px}.summary{font-size:20px;background:#fff;padding:24px;border-left:5px solid #2457ff}a{color:#2457ff}li{margin:8px 0}footer{margin-top:60px;border-top:1px solid #aaa;padding-top:18px;color:#667085;font-size:12px}@media print{body{background:#fff;padding:0}a{text-decoration:none}}</style></head><body><header><small>DUKJIN GLOBAL · AI VIDEO REPORT</small><h1>${escapeHtml(report.title)}</h1><p>${escapeHtml(report.subtitle)}</p><p class="meta">${escapeHtml(video.title)} · ${escapeHtml(language)} · AI-generated</p></header><h2>${labels.executive}</h2><p class="summary">${escapeHtml(report.executiveSummary)}</p>${sections}<section><h2>${labels.recommendations}</h2><ol>${(report.recommendations || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol></section><section><h2>${labels.caveats}</h2><ul>${(report.caveats || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section><footer>Dukjin Global · Built with Codex · ${labels.generated}</footer></body></html>`;
}

function wrapLines(context, text, maxWidth, maxLines = 6) {
  const source = safe(text);
  const words = typeof Intl.Segmenter === "function"
    ? [...new Intl.Segmenter(undefined, { granularity: "word" }).segment(source)].map((item) => item.segment)
    : source.split(/(\s+)/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = `${line}${word}`;
    if (context.measureText(candidate).width <= maxWidth || !line) line = candidate;
    else { lines.push(line); line = word; }
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join("") !== lines.join("")) lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[.…]*$/, "")}…`;
  return lines;
}

function drawWrapped(context, text, x, y, maxWidth, lineHeight, maxLines) {
  const lines = wrapLines(context, text, maxWidth, maxLines);
  lines.forEach((line, index) => context.fillText(line, x, y + index * lineHeight));
  return y + lines.length * lineHeight;
}

function roundedRect(context, x, y, width, height, radius = 20) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.fill();
}

export function renderInfographicCanvas(infographic, video, language) {
  const labels = labelsFor(language);
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1920;
  const context = canvas.getContext("2d");
  context.textBaseline = "top";
  context.fillStyle = "#f4f0e7";
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.fillStyle = "#101827";
  context.fillRect(0, 0, 1080, 475);
  context.fillStyle = "#f3b83f";
  context.fillRect(58, 58, 130, 8);
  context.font = "800 22px Arial, sans-serif";
  context.fillText(`DUKJIN GLOBAL · ${safe(language).toUpperCase()}`, 58, 86);
  context.fillStyle = "#ffffff";
  context.font = "800 68px Arial, sans-serif";
  let y = drawWrapped(context, infographic.title, 58, 140, 930, 76, 3);
  context.fillStyle = "#aebbf0";
  context.font = "400 28px Arial, sans-serif";
  y = drawWrapped(context, infographic.subtitle, 58, y + 18, 920, 38, 2);
  context.fillStyle = "#2457ff";
  context.fillRect(58, 405, 964, 120);
  context.fillStyle = "#ffffff";
  context.font = "700 28px Arial, sans-serif";
  drawWrapped(context, infographic.keyMessage, 86, 433, 905, 36, 2);

  const facts = (infographic.facts || []).slice(0, 3);
  facts.forEach((fact, index) => {
    const x = 58 + index * 326;
    context.fillStyle = index === 1 ? "#ffffff" : "#ebe5d8";
    roundedRect(context, x, 575, 300, 275, 12);
    context.fillStyle = "#2457ff";
    context.font = "800 18px Arial, sans-serif";
    context.fillText(safe(fact.label).toUpperCase(), x + 22, 600);
    context.fillStyle = "#101827";
    context.font = "800 40px Arial, sans-serif";
    drawWrapped(context, fact.value, x + 22, 642, 256, 48, 2);
    context.fillStyle = "#667085";
    context.font = "400 19px Arial, sans-serif";
    drawWrapped(context, fact.detail, x + 22, 745, 256, 27, 3);
    context.fillStyle = "#8b6a18";
    context.font = "700 15px Arial, sans-serif";
    context.fillText(formatTimestamp(fact.startMs), x + 22, 818);
  });

  context.fillStyle = "#101827";
  context.font = "800 24px Arial, sans-serif";
  context.fillText(labels.timeline.toUpperCase(), 58, 910);
  context.fillStyle = "#2457ff";
  context.fillRect(58, 952, 4, 545);
  (infographic.timeline || []).slice(0, 4).forEach((item, index) => {
    const itemY = 970 + index * 132;
    context.fillStyle = "#2457ff";
    context.beginPath(); context.arc(60, itemY + 14, 16, 0, Math.PI * 2); context.fill();
    context.fillStyle = "#ffffff";
    context.font = "800 14px Arial, sans-serif";
    context.fillText(String(index + 1).padStart(2, "0"), 51, itemY + 6);
    context.fillStyle = "#101827";
    context.font = "800 27px Arial, sans-serif";
    context.fillText(safe(item.title), 100, itemY);
    context.fillStyle = "#667085";
    context.font = "400 20px Arial, sans-serif";
    drawWrapped(context, item.detail, 100, itemY + 42, 820, 28, 2);
    context.fillStyle = "#2457ff";
    context.font = "700 16px Arial, sans-serif";
    context.fillText(formatTimestamp(item.startMs), 930, itemY + 4);
  });

  context.fillStyle = "#e8edff";
  roundedRect(context, 58, 1530, 964, 290, 16);
  context.fillStyle = "#2457ff";
  context.font = "800 20px Arial, sans-serif";
  context.fillText(labels.takeaways.toUpperCase(), 86, 1558);
  (infographic.takeaways || []).slice(0, 3).forEach((item, index) => {
    const itemY = 1605 + index * 62;
    context.fillStyle = "#2457ff";
    context.font = "800 22px Arial, sans-serif";
    context.fillText(`0${index + 1}`, 86, itemY);
    context.fillStyle = "#101827";
    context.font = "600 21px Arial, sans-serif";
    drawWrapped(context, item.text, 140, itemY, 780, 28, 2);
    context.fillStyle = "#667085";
    context.font = "700 15px Arial, sans-serif";
    context.fillText(formatTimestamp(item.startMs), 930, itemY + 3);
  });
  context.fillStyle = "#101827";
  context.font = "700 16px Arial, sans-serif";
  context.fillText(safe(infographic.footer || video.title).slice(0, 105), 58, 1860);
  context.fillStyle = "#667085";
  context.font = "400 14px Arial, sans-serif";
  context.fillText(labels.generated.toUpperCase(), 58, 1890);
  return canvas;
}

export function downloadUrl(url, filename) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
}

export function downloadText(text, filename, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  downloadUrl(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
