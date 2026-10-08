/**
 * accountFallback/perModelFailureScope.ts — whether a NON-QUOTA failure should lock
 * one model instead of cooling the whole connection.
 *
 * Extracted from services/accountFallback.ts (file-size gate, #12334). A Claude
 * OAuth connection multiplexes Fable 5, Opus, Sonnet and Haiku behind one
 * credential, so a 404/5xx names one model. Quota is a separate question:
 * hasPerModelQuota("claude") is false and a 429 stays account-wide.
 */
import { resolveProviderId } from "../../../src/shared/constants/providers";
import { hasPerModelQuota } from "../accountFallback.ts";

// Bounded quantifiers keep this ReDoS-safe.
const MODEL_NOT_FOUND_404_REGEX =
  /model_not_found|model[^\n]{0,120}(?:does not exist|not found|is not available|do not have access)/i;

/**
 * #15633: a 404 whose body names a missing MODEL (e.g. Groq `model_not_found`) is
 * model-scoped for every provider — lock that model only, never the connection.
 * A bare endpoint/URL 404 carries no model wording and keeps the connection cooldown.
 */
export function isModelNotFound404(status: number | undefined, errorText: unknown): boolean {
  if (status !== 404) return false;
  const text = typeof errorText === "string" ? errorText : JSON.stringify(errorText ?? "");
  return MODEL_NOT_FOUND_404_REGEX.test(text);
}

// Groq: "Request too large for model `<id>` in organization … on tokens per minute".
const MODEL_SCOPED_413_REGEX = /too large for model\b/i;

/**
 * #15788: a 413 whose body names the MODEL it is too large for is a limit of that
 * model's tier (Groq TPM), not of the connection — another model on the same key
 * would have served the request. A bare 413 keeps the connection-wide behaviour.
 */
export function isModelScoped413(status: number | undefined, errorText: unknown): boolean {
  if (status !== 413) return false;
  const text = typeof errorText === "string" ? errorText : JSON.stringify(errorText ?? "");
  return MODEL_SCOPED_413_REGEX.test(text);
}

/**
 * @param status - When 429, only per-model *quota* providers qualify. Omit for
 *   the non-quota question (404/5xx), which also includes Claude.
 */
export function hasPerModelFailureScope(
  provider: string | null | undefined,
  model: string | null | undefined = null,
  connectionPassthroughModels?: boolean,
  status?: number,
  errorText?: unknown
): boolean {
  if (isModelNotFound404(status, errorText) || isModelScoped413(status, errorText)) return true;
  if (status === 429) return hasPerModelQuota(provider, model, connectionPassthroughModels);
  if (hasPerModelQuota(provider, model, connectionPassthroughModels)) return true;
  if (typeof connectionPassthroughModels === "boolean") return connectionPassthroughModels;
  if (!provider) return false;
  return resolveProviderId(provider) === "claude";
}
