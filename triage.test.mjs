import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "./server.mjs";

let server;
let baseUrl;

before(async () => {
  server = createApp(); // настоящий имитатор и таймаут 300 мс
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

async function triage(body) {
  const response = await fetch(`${baseUrl}/api/triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

const MANUAL_REVIEW = { status: "manual_review", topic: null, draft: null };

test("корректная заявка → ready с темой и черновиком", async () => {
  const { status, body } = await triage({ text: "Какая цена доставки?" });
  assert.equal(status, 200);
  assert.equal(body.status, "ready");
  assert.equal(body.topic, "pricing");
  assert.ok(body.draft.trim());
});

for (const [name, payload] of [
  ["битый JSON", "{not json"],
  ["нет поля text", {}],
  ["text не строка", { text: 42 }],
  ["пустой text", { text: "   " }],
  ["тело null", "null"],
]) {
  test(`невалидный ввод (${name}) → 400 invalid_input`, async () => {
    assert.deepEqual(await triage(payload), { status: 400, body: { status: "invalid_input" } });
  });
}

for (const tag of ["[error]", "[bad-json]", "[bad-topic]", "[empty-draft]"]) {
  test(`сбой модели ${tag} → manual_review`, async () => {
    assert.deepEqual(await triage({ text: `Заявка ${tag}` }), { status: 200, body: MANUAL_REVIEW });
  });
}

test("таймаут модели → manual_review не дольше ~300 мс", async () => {
  const started = Date.now();
  const result = await triage({ text: "Заявка [timeout]" });
  const elapsed = Date.now() - started;
  assert.deepEqual(result, { status: 200, body: MANUAL_REVIEW });
  assert.ok(elapsed < 800, `ответ занял ${elapsed} мс`);
});
