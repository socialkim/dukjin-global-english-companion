import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";

const PORT = Number(process.env.PORT || 8787);
const API_KEY = process.env.OPENAI_API_KEY || "";
const PROXY_TOKEN = process.env.PROXY_TOKEN || "";
const ALLOWED_EXTENSION_ID = process.env.ALLOWED_EXTENSION_ID || "";
const MAX_BODY_BYTES = 2_000_000;

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

function allowedOrigin(origin) {
  if (!origin) return "";
  if (ALLOWED_EXTENSION_ID) return origin === `chrome-extension://${ALLOWED_EXTENSION_ID}` ? origin : "";
  if (origin.startsWith("chrome-extension://")) return origin;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return "";
}

function applyCors(request, response) {
  const origin = allowedOrigin(request.headers.origin || "");
  if (origin) response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Proxy-Token");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  return Boolean(origin);
}

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Request body is too large."), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("Request body must be valid JSON."), { status: 400 }); }
}

function sanitizeRequest(body) {
  const model = String(body?.model || "");
  if (!/^(gpt-5\.(4|5|6)(-[a-z0-9.-]+)?|chat-latest)$/i.test(model)) {
    throw Object.assign(new Error("This proxy only allows supported GPT-5.4–5.6 text models."), { status: 400 });
  }
  if (typeof body?.input !== "string" || body.input.length > 1_800_000) {
    throw Object.assign(new Error("Input must be text under 1.8 MB."), { status: 400 });
  }
  return {
    model,
    reasoning: body.reasoning,
    instructions: String(body.instructions || "").slice(0, 20_000),
    input: body.input,
    max_output_tokens: Math.min(16_000, Math.max(64, Number(body.max_output_tokens) || 8_000)),
    text: body.text
  };
}

const server = createServer(async (request, response) => {
  const corsAllowed = applyCors(request, response);
  if (request.method === "OPTIONS") {
    response.writeHead(corsAllowed ? 204 : 403);
    response.end();
    return;
  }
  if (request.method === "GET" && request.url === "/health") {
    json(response, 200, { ok: true, configured: Boolean(API_KEY), protected: Boolean(PROXY_TOKEN || ALLOWED_EXTENSION_ID) });
    return;
  }
  if (request.method !== "POST" || request.url !== "/v1/responses") {
    json(response, 404, { error: { message: "Not found." } });
    return;
  }
  if (!corsAllowed) {
    json(response, 403, { error: { message: "Origin is not allowed." } });
    return;
  }
  if (!API_KEY) {
    json(response, 503, { error: { message: "OPENAI_API_KEY is not configured on the proxy." } });
    return;
  }
  if (PROXY_TOKEN && !safeEqual(request.headers["x-proxy-token"], PROXY_TOKEN)) {
    json(response, 401, { error: { message: "Invalid proxy token." } });
    return;
  }
  try {
    const body = sanitizeRequest(await readJson(request));
    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify(body)
    });
    const payload = await upstream.text();
    response.writeHead(upstream.status, { "Content-Type": upstream.headers.get("content-type") || "application/json", "Cache-Control": "no-store" });
    response.end(payload);
  } catch (error) {
    json(response, error.status || 500, { error: { message: error.message || "Proxy request failed." } });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Dukjin Global proxy listening on http://127.0.0.1:${PORT}`);
  if (!PROXY_TOKEN) console.warn("PROXY_TOKEN is not set. Configure it before exposing this proxy beyond localhost.");
});
