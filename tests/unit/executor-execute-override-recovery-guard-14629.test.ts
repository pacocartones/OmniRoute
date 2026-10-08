/**
 * #14629 guard (requested in #14774 "Remaining"): an executor that overrides
 * execute() without calling super.execute() loses BaseExecutor's reactive 400
 * recovery chain (thinking-budget and reasoning_effort clamp-and-retry). #14774
 * and #14915 wired the OpenAI-shaped executors through the shared
 * applyReasoningEffortRecovery() helper instead.
 *
 * Auditing every existing override is out of scope here, so this is a ratchet: the
 * overrides that existed when the guard landed are frozen below, a NEW override must
 * call super.execute() or applyReasoningEffortRecovery(), and an entry that becomes
 * compliant must leave the list so it cannot regress silently.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const EXECUTORS_DIR = path.resolve(import.meta.dirname, "../../open-sse/executors");

// Overrides without the recovery chain when the guard landed. Most are web or
// scraper bridges that never send an OpenAI-style body. Shrink only.
const FROZEN_WITHOUT_RECOVERY = new Set([
  "adapta-web.ts",
  "adobe-firefly.ts",
  "antigravity.ts",
  "auggie.ts",
  "bedrock.ts",
  "blackbox-web.ts",
  "chatgpt-web-codex.ts",
  "chatgpt-web.ts",
  "chatplayground.ts",
  "claude-web.ts",
  "cloudflare-playground.ts",
  "codex-app-server.ts",
  "conol-web.ts",
  "copilot-m365-web.ts",
  "copilot-web.ts",
  "cursor.ts",
  "dario.ts",
  "deepseek-web.ts",
  "devin-cli-agentic.ts",
  "devin-cli.ts",
  "devin-desktop.ts",
  "doubao-web.ts",
  "duckduckgo-web.ts",
  "freebuff.ts",
  "gemini-web.ts",
  "gitlab.ts",
  "grok-web.ts",
  "huggingchat.ts",
  "hyperagent.ts",
  "inner-ai.ts",
  "kimi-web.ts",
  "kiro.ts",
  "lmarena.ts",
  "maxai.ts",
  "muse-spark-web.ts",
  "ninerouter.ts",
  "nlpcloud.ts",
  "notion-web.ts",
  "notrack-web.ts",
  "oneminai.ts",
  "perplexity-web.ts",
  "poe-web.ts",
  "promptql.ts",
  "qoder.ts",
  "syntx.ts",
  "t3-chat-web.ts",
  "tencent-aistudio-web.ts",
  "tinycms.ts",
  "trae.ts",
  "twinmind.ts",
  "uc.ts",
  "v0-vercel-web.ts",
  "venice-web.ts",
  "veoaifree-web.ts",
  "yuanbao-web.ts",
  "zai-web.ts",
  "zcode.ts",
  "zed-hosted.ts",
  "zenmux-free.ts",
]);

function overridesWithoutRecovery(): string[] {
  return fs
    .readdirSync(EXECUTORS_DIR)
    .filter((name) => name.endsWith(".ts"))
    .filter((name) => {
      const source = fs.readFileSync(path.join(EXECUTORS_DIR, name), "utf8");
      if (!source.includes("async execute(")) return false;
      return !/super\.execute\(|applyReasoningEffortRecovery\(/.test(source);
    })
    .sort();
}

test("a new executor override reaches the 400 recovery chain (#14629)", () => {
  const unexpected = overridesWithoutRecovery().filter(
    (name) => !FROZEN_WITHOUT_RECOVERY.has(name)
  );
  assert.deepEqual(
    unexpected,
    [],
    "these executors override execute() without super.execute() or applyReasoningEffortRecovery(); " +
      "wire the recovery (see #14774/#14915) or, for a non-OpenAI body, justify it in review"
  );
});

test("the frozen list only shrinks: compliant or removed executors leave it", () => {
  const current = new Set(overridesWithoutRecovery());
  const stale = [...FROZEN_WITHOUT_RECOVERY].filter((name) => !current.has(name)).sort();
  assert.deepEqual(stale, [], "remove these from FROZEN_WITHOUT_RECOVERY");
});
