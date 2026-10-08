import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import {
  enrichCatalogModelEntry,
  type CatalogEnrichmentSnapshot,
} from "../../src/lib/modelMetadataRegistry.ts";
import {
  saveModelsDevPricing,
  clearModelsDevPricing,
  getModelsDevPricing,
  type PricingByProvider,
} from "../../src/lib/modelsDevSync.ts";
import { updatePricing, resetAllPricing } from "../../src/lib/db/settings/pricing.ts";

type CatalogPricing = {
  input?: number;
  output?: number;
  cached?: number;
  cache_creation?: number;
};

// #15528: GET /v1/models resolved pricing from models.dev → LiteLLM → defaults and
// never consulted the `user` layer (PATCH /api/pricing), although getPricing() and
// the documented order put it first: user > models.dev > LiteLLM > defaults.
describe("catalog pricing honours the user layer (#15528)", () => {
  before(async () => {
    const modelsDev: PricingByProvider = {
      "opencode-go": {
        "deepseek-v4.1-flash": { input: 0.15, output: 0.6, cached: 0.003 },
        "partial-model": { input: 1, output: 2 },
      },
    };
    saveModelsDevPricing(modelsDev);
    await updatePricing({
      "opencode-go": {
        "deepseek-v4.1-flash": { input: 0.3, output: 1.2, cached: 0.01 },
        "partial-model": { output: 5 },
        "user-only-model": { input: 7, output: 8 },
      },
    });
  });

  after(async () => {
    try {
      clearModelsDevPricing();
      await resetAllPricing();
    } catch {
      // ignore
    }
  });

  const entry = (model: string) => ({
    id: `opencode-go/${model}`,
    owned_by: "opencode-go",
    root: model,
  });

  it("a user override wins over the models.dev value for the same model", () => {
    const pricing = enrichCatalogModelEntry(entry("deepseek-v4.1-flash")).pricing as CatalogPricing;
    assert.deepEqual(pricing, { input: 0.3, output: 1.2, cached: 0.01 });
  });

  it("a partial user override is merged field by field over the lower layer", () => {
    const pricing = enrichCatalogModelEntry(entry("partial-model")).pricing as CatalogPricing;
    assert.deepEqual(pricing, { input: 1, output: 5 });
  });

  it("a model priced only by the user still gets pricing", () => {
    const pricing = enrichCatalogModelEntry(entry("user-only-model")).pricing as CatalogPricing;
    assert.deepEqual(pricing, { input: 7, output: 8 });
  });

  it("the build-local snapshot path applies the same user layer", () => {
    const snapshot: CatalogEnrichmentSnapshot = {
      modelsDevPricing: getModelsDevPricing(),
      userPricing: {
        "opencode-go": { "deepseek-v4.1-flash": { input: 0.3, output: 1.2, cached: 0.01 } },
      },
    };
    const pricing = enrichCatalogModelEntry(entry("deepseek-v4.1-flash"), undefined, snapshot)
      .pricing as CatalogPricing;
    assert.deepEqual(pricing, { input: 0.3, output: 1.2, cached: 0.01 });
  });

  it("a later PATCH is visible without a restart", async () => {
    await updatePricing({ "opencode-go": { "deepseek-v4.1-flash": { input: 0.4 } } });
    const pricing = enrichCatalogModelEntry(entry("deepseek-v4.1-flash")).pricing as CatalogPricing;
    assert.equal(pricing.input, 0.4);
  });
});
