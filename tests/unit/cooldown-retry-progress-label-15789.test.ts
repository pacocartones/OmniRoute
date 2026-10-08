/**
 * #15789 — the COOLDOWN_RETRY path logged "restarting request attempt 4/3".
 *
 * The loop in src/sse/handlers/chat.ts dispatches once, then restarts while
 * getCooldownAwareRetryDecision() says shouldRetry. The decision stops at
 * `attempt >= maxRetries`, so max = 3 means 3 restarts and 4 upstream
 * dispatches: the count was right. The restart line labelled the counter as
 * a request *attempt* (1-based, initial dispatch included) against a max that
 * counts *retries*, so the last restart printed 4/3.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { getCooldownAwareRetryDecision, describeCooldownRetry } =
  await import("../../src/sse/services/cooldownAwareRetry.ts");

const settings = {
  enabled: true,
  maxRetries: 3,
  maxRetryWaitSec: 90,
  maxRetryWaitMs: 90000,
  budgetMs: 300000,
};

/** Mirrors the requestAttemptLoop restart bookkeeping in chat.ts. */
function runCooldownLoop() {
  let dispatches = 0;
  let requestRetryAttempt = 0;
  const waitLabels: string[] = [];
  const restartLabels: string[] = [];

  for (;;) {
    dispatches += 1; // every pass through the loop sends the request upstream
    const decision = getCooldownAwareRetryDecision({
      retryAfter: new Date(Date.now() + 1000).toISOString(),
      settings,
      attempt: requestRetryAttempt,
      budgetLeftMs: settings.budgetMs,
    });
    if (!decision.shouldRetry) break;
    waitLabels.push(describeCooldownRetry(requestRetryAttempt + 1, settings.maxRetries));
    requestRetryAttempt += 1;
    restartLabels.push(describeCooldownRetry(requestRetryAttempt, settings.maxRetries));
  }

  return { dispatches, waitLabels, restartLabels };
}

test("max = 3 dispatches upstream exactly 4 times (1 initial + 3 cooldown restarts)", () => {
  assert.equal(runCooldownLoop().dispatches, 4);
});

test("the wait and restart lines of one retry carry the same n/max, never above max", () => {
  const { waitLabels, restartLabels } = runCooldownLoop();
  assert.deepEqual(waitLabels, ["retry 1/3", "retry 2/3", "retry 3/3"]);
  assert.deepEqual(restartLabels, waitLabels);
});

test("chat.ts builds both COOLDOWN_RETRY progress labels with describeCooldownRetry()", () => {
  const source = fs.readFileSync(
    new URL("../../src/sse/handlers/chat.ts", import.meta.url),
    "utf8"
  );
  assert.ok(!source.includes("restarting request attempt ${requestRetryAttempt + 1}"));
  assert.ok(
    source.includes("describeCooldownRetry(requestRetryAttempt + 1, retrySettings.maxRetries)")
  );
  assert.ok(
    source.includes("describeCooldownRetry(requestRetryAttempt, retrySettings.maxRetries)")
  );
});
