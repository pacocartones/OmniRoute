import test from "node:test";
import assert from "node:assert/strict";

const { geminiToOpenAIResponse } =
  await import("../../open-sse/translator/response/gemini-to-openai.ts");

type Chunk = { choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }> };

function streamText(parts: string[]): string {
  const state: Record<string, unknown> = { toolCalls: new Map() };
  let text = "";
  parts.forEach((part, i) => {
    const last = i === parts.length - 1;
    const out = geminiToOpenAIResponse(
      {
        responseId: "resp-trailing-lt",
        modelVersion: "gemini-2.5-flash",
        candidates: [
          {
            content: { parts: [{ text: part }] },
            ...(last ? { finishReason: "STOP" } : {}),
          },
        ],
      },
      state
    ) as Chunk[] | null;
    for (const c of out || []) text += c.choices?.[0]?.delta?.content ?? "";
  });
  return text;
}

test("a reply that ends with '<' keeps it (held back as a possible <think> prefix)", () => {
  assert.equal(streamText(["Declare it as Array<"]), "Declare it as Array<");
});

test("a reply that ends with a partial reasoning-tag prefix keeps it", () => {
  assert.equal(streamText(["Use the ", "<thi"]), "Use the <thi");
});

test("a held '<' is still joined with the next chunk when it is not a reasoning tag", () => {
  assert.equal(streamText(["a <", "b and done"]), "a <b and done");
});
