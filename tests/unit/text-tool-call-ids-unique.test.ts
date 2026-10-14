import test from "node:test";
import assert from "node:assert/strict";

const { openaiToClaudeResponse } =
  await import("../../open-sse/translator/response/openai-to-claude.ts");
const { geminiToClaudeResponse } =
  await import("../../open-sse/translator/response/gemini-to-claude.ts");

type Ev = { type: string; content_block?: { type?: string; id?: string } };

const toolUseIds = (events: Ev[]) =>
  events
    .filter((e) => e.type === "content_block_start" && e.content_block?.type === "tool_use")
    .map((e) => e.content_block?.id);

const INVOKE = '<invoke name="Read"><parameter name="path">a.txt</parameter></invoke>';
const TOOL_CALL = '<tool_call>{"name":"Read","arguments":{"path":"a.txt"}}</tool_call>';

// Two chunks handled inside the same millisecond (a batched upstream read) used to mint the
// same `toolu_xml_<ms>_0` id, because the per-call counter restarts at 0 on every chunk.
function withFrozenClock<T>(fn: () => T): T {
  const realNow = Date.now;
  Date.now = () => 1_700_000_000_000;
  try {
    return fn();
  } finally {
    Date.now = realNow;
  }
}

for (const [label, block] of [
  ["<invoke>", INVOKE],
  ["<tool_call>", TOOL_CALL],
] as const) {
  test(`openai→claude: two ${label} tool calls in separate chunks get distinct tool_use ids`, () => {
    const events = withFrozenClock(() => {
      const state = {
        provider: "openai",
        toolCalls: new Map(),
        _pendingXmlToolCalls: [],
        _xmlInvokeBuffer: "",
      };
      const out: Ev[] = [];
      for (const content of [block, block]) {
        const r = openaiToClaudeResponse(
          {
            id: "chatcmpl-ids",
            model: "gpt-test",
            choices: [{ index: 0, delta: { content }, finish_reason: null }],
          },
          state
        );
        if (r) out.push(...(r as Ev[]));
      }
      const fin = openaiToClaudeResponse(
        {
          id: "chatcmpl-ids",
          model: "gpt-test",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        },
        state
      );
      if (fin) out.push(...(fin as Ev[]));
      return out;
    });
    const ids = toolUseIds(events);
    assert.equal(ids.length, 2);
    assert.notEqual(ids[0], ids[1]);
  });

  test(`gemini→claude: two ${label} tool calls in separate chunks get distinct tool_use ids`, () => {
    const events = withFrozenClock(() => {
      const state = {};
      const out: Ev[] = [];
      for (const text of [block, block]) {
        const r = geminiToClaudeResponse(
          {
            responseId: "resp-ids",
            modelVersion: "gemini-2.5-pro",
            candidates: [{ content: { parts: [{ text }] } }],
          },
          state
        );
        if (r) out.push(...(r as Ev[]));
      }
      return out;
    });
    const ids = toolUseIds(events);
    assert.equal(ids.length, 2);
    assert.notEqual(ids[0], ids[1]);
  });
}
