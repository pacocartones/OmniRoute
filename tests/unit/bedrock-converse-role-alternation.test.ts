import test from "node:test";
import assert from "node:assert/strict";

import { openAIToBedrockConverse } from "../../open-sse/executors/bedrock.ts";

// Bedrock Converse answers a conversation whose roles do not strictly alternate with
// ValidationException "A conversation must alternate between user and assistant roles".
// OpenAI chat histories legitimately contain consecutive same-role turns.

const MODEL = "anthropic.claude-sonnet-4-6";

function roles(payload) {
  return payload.messages.map((message) => message.role);
}

function assertAlternates(payload) {
  const sequence = roles(payload);
  for (let i = 1; i < sequence.length; i++) {
    assert.notEqual(sequence[i], sequence[i - 1], `roles must alternate: ${sequence.join(",")}`);
  }
}

test("openAIToBedrockConverse folds consecutive user messages into one turn", () => {
  const payload = openAIToBedrockConverse(MODEL, {
    messages: [
      { role: "user", content: "first" },
      { role: "user", content: "second" },
    ],
  });

  assertAlternates(payload);
  assert.equal(payload.messages.length, 1);
  assert.deepEqual(
    payload.messages[0].content.map((block) => block.text),
    ["first", "second"]
  );
});

test("openAIToBedrockConverse keeps a user follow-up in the same turn as the tool result before it", () => {
  const payload = openAIToBedrockConverse(MODEL, {
    messages: [
      { role: "user", content: "list files" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "call_ls", type: "function", function: { name: "ls", arguments: "{}" } },
        ],
      },
      { role: "tool", tool_call_id: "call_ls", content: "a.txt" },
      { role: "user", content: "now read it" },
    ],
  });

  assertAlternates(payload);
  assert.deepEqual(roles(payload), ["user", "assistant", "user"]);
  const lastTurn = payload.messages[2].content;
  assert.equal(lastTurn[0].toolResult?.toolUseId, "call_ls");
  assert.equal(lastTurn[1].text, "now read it");
});

test("openAIToBedrockConverse folds an assistant text turn into the assistant turn that carries its tool call", () => {
  const payload = openAIToBedrockConverse(MODEL, {
    messages: [
      { role: "user", content: "list files" },
      { role: "assistant", content: "Let me look." },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "call_ls", type: "function", function: { name: "ls", arguments: "{}" } },
        ],
      },
      { role: "tool", tool_call_id: "call_ls", content: "a.txt" },
    ],
  });

  assertAlternates(payload);
  assert.deepEqual(roles(payload), ["user", "assistant", "user"]);
  const assistantBlocks = payload.messages[1].content;
  assert.equal(assistantBlocks[0].text, "Let me look.");
  assert.equal(assistantBlocks[1].toolUse?.toolUseId, "call_ls");
});

test("openAIToBedrockConverse does not keep the empty-turn filler next to real content", () => {
  const payload = openAIToBedrockConverse(MODEL, {
    messages: [
      { role: "user", content: "" },
      { role: "user", content: "real question" },
    ],
  });

  assert.equal(payload.messages.length, 1);
  assert.deepEqual(
    payload.messages[0].content.map((block) => block.text),
    ["real question"]
  );
});
