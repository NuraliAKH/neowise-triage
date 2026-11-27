import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { classify } from "./mock-ai.mjs";

const html = await readFile(new URL("./index.html", import.meta.url));

export const MODEL_TIMEOUT_MS = 300;
const TOPICS = new Set(["delivery", "pricing", "other"]);
const MANUAL_REVIEW = { status: "manual_review", topic: null, draft: null };

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

// null — ввод невалиден (битый JSON, нет text, не строка, пусто после trim).
async function readText(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  try {
    const text = JSON.parse(Buffer.concat(chunks).toString("utf8"))?.text;
    return typeof text === "string" && text.trim() ? text : null;
  } catch {
    return null;
  }
}

// Ответ модели — недоверенные данные: пропускаем только известную тему и непустой черновик.
export function parseModelOutput(raw) {
  try {
    const { topic, draft } = JSON.parse(raw);
    if (TOPICS.has(topic) && typeof draft === "string" && draft.trim()) {
      return { status: "ready", topic, draft };
    }
  } catch {}
  return null;
}

async function askModel(text, classifyFn, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Model timeout"));
    }, timeoutMs);
  });
  try {
    // race — на случай, если модель не реагирует на signal
    return await Promise.race([classifyFn(text, { signal: controller.signal }), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function createApp({ classifyFn = classify, timeoutMs = MODEL_TIMEOUT_MS } = {}) {
  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(html);
      return;
    }
    if (request.method !== "POST" || request.url !== "/api/triage") {
      return json(response, 404, { status: "not_found" });
    }
    try {
      const text = await readText(request);
      if (text === null) return json(response, 400, { status: "invalid_input" });

      let result = null;
      try {
        result = parseModelOutput(await askModel(text, classifyFn, timeoutMs));
      } catch (error) {
        console.warn("Model failed:", error.message);
      }
      if (!result) console.warn("Triage fell back to manual_review");
      json(response, 200, result ?? MANUAL_REVIEW);
    } catch {
      json(response, 500, { status: "server_error" });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createApp().listen(Number(process.env.PORT || 3000), "127.0.0.1");
}
