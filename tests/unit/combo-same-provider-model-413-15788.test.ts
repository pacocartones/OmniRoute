import test from "node:test";
import assert from "node:assert/strict";

import { normalizeHeaders } from "../../open-sse/utils/headers.ts";
import { createChatPipelineHarness } from "../integration/_chatPipelineHarness.ts";

/**
 * #15788 (413 half): Groq answers `413 Request too large for model <id> … on tokens
 * per minute (TPM)` — a limit of THAT model's tier, not of the key. Another model on
 * the same connection would have served the request, so the combo must reach it
 * instead of treating the whole connection as gone. Before this fix the TPM wording
 * cooled the whole connection, so the sibling was never tried (companion of #15633).
 */
const harness = await createChatPipelineHarness("combo-same-provider-model-413-15788");
const { buildRequest, combosDb, handleChat, resetStorage, seedConnection, settingsDb } = harness;

test.beforeEach(async () => {
  await resetStorage();
});

test.afterEach(async () => {
  await resetStorage();
});

test.after(async () => {
  await harness.cleanup();
});

const TOO_LARGE_FOR_MODEL = JSON.stringify({
  error: {
    message:
      "Request too large for model `qwen/qwen3.8-27b` in organization `org_test` service tier `on_demand` on tokens per minute (TPM): Limit 6000, Requested 9154, please reduce your message size and try again.",
    type: "tokens",
    code: "rate_limit_exceeded",
  },
});

function openAiCompletion(content: string) {
  return new Response(
    JSON.stringify({
      id: "chatcmpl-15788",
      object: "chat.completion",
      created: 1,
      model: "llama-3.3-70b-versatile",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

async function runCombo(first413Body: string) {
  await seedConnection("groq", { apiKey: "gsk-15788" });
  await settingsDb.updateSettings({ requestRetry: 0, maxRetryIntervalSec: 0 });
  await combosDb.createCombo({
    name: "groq-model-413-combo",
    strategy: "priority",
    config: { maxRetries: 0, retryDelayMs: 0 },
    models: ["groq/qwen/qwen3.8-27b", "groq/llama-3.3-70b-versatile"],
  });

  const dispatched: string[] = [];
  globalThis.fetch = async (_url, init = {}) => {
    const headers = normalizeHeaders(init.headers);
    const authHeader = headers.authorization ?? headers.Authorization;
    if (authHeader !== "Bearer gsk-15788") {
      throw new Error(`unexpected upstream headers: ${JSON.stringify(headers)}`);
    }
    const sent = JSON.parse(String(init.body ?? "{}")) as { model?: string };
    dispatched.push(String(sent.model));
    if (sent.model === "qwen/qwen3.8-27b") {
      return new Response(first413Body, {
        status: 413,
        headers: { "Content-Type": "application/json" },
      });
    }
    return openAiCompletion("served by the sibling model");
  };

  const response = await handleChat(
    buildRequest({
      body: {
        model: "groq-model-413-combo",
        stream: false,
        messages: [{ role: "user", content: "a long prompt" }],
      },
    })
  );
  return { response, dispatched };
}

test("a 413 that names one model lets the combo reach a sibling model on the same connection (#15788)", async () => {
  const { response, dispatched } = await runCombo(TOO_LARGE_FOR_MODEL);
  const body = (await response.json()) as { choices?: Array<{ message: { content: string } }> };

  assert.deepEqual(dispatched, ["qwen/qwen3.8-27b", "llama-3.3-70b-versatile"]);
  assert.equal(response.status, 200);
  assert.equal(body.choices?.[0]?.message.content, "served by the sibling model");
});

// Pins today's behaviour for a 413 that carries no model wording (it already reaches the
// sibling on the base, because nothing classifies it as a TPM rate limit): this change
// must not alter it.
test("a bare 413 with no model wording keeps its existing behaviour", async () => {
  const { dispatched } = await runCombo(
    JSON.stringify({
      error: { message: "Request Entity Too Large", type: "invalid_request_error" },
    })
  );

  assert.deepEqual(dispatched, ["qwen/qwen3.8-27b", "llama-3.3-70b-versatile"]);
});

test("isModelScoped413 only matches a 413 that names the model it is too large for", async () => {
  const { isModelScoped413, hasPerModelFailureScope } =
    await import("../../open-sse/services/accountFallback/perModelFailureScope.ts");

  assert.equal(isModelScoped413(413, TOO_LARGE_FOR_MODEL), true);
  assert.equal(isModelScoped413(413, JSON.parse(TOO_LARGE_FOR_MODEL)), true);
  assert.equal(isModelScoped413(413, "Request Entity Too Large"), false);
  assert.equal(isModelScoped413(429, TOO_LARGE_FOR_MODEL), false);
  assert.equal(
    hasPerModelFailureScope("groq", "qwen/qwen3.8-27b", undefined, 413, TOO_LARGE_FOR_MODEL),
    true
  );
  assert.equal(
    hasPerModelFailureScope("groq", "qwen/qwen3.8-27b", undefined, 413, "Request Entity Too Large"),
    false
  );
});
