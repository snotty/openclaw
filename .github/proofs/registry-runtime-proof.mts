import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const root = resolve(process.argv[2]);
const load = (file) => import(pathToFileURL(`${root}/${file}`).href);
const { AuthStorage } = await load("src/agents/sessions/auth-storage.ts");
const { ModelRegistry } = await load("src/agents/sessions/model-registry.ts");
const { createModelSelectionState } = await load("src/auto-reply/reply/model-selection.ts");
const { resolveContextTokens } = await load("src/auto-reply/reply/model-selection-context.ts");
const { findModelInCatalog } = await load("src/agents/model-catalog-lookup.ts");
const { resolveCompactionThreshold } = await load("src/auto-reply/reply/memory-flush.ts");
const { resolveEmbeddedRuntimeModelPolicy } = await load(
  "src/agents/embedded-agent-runner/run/setup.ts",
);
const registry = ModelRegistry.inMemory(AuthStorage.inMemory());
const id = "shared-model";
// Authored route selection only: no configured token budget or provider override.
const cfg = {
  agents: {
    defaults: {
      models: {
        "fixture-primary/shared-model": {},
        "fixture-secondary/shared-model": {},
      },
    },
  },
};
function register(provider, contextWindow, contextTokens) {
  registry.registerProvider(provider, {
    api: "openai-responses",
    baseUrl: "https://models.example/v1",
    models: [
      {
        id,
        name: "Shared model",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow,
        contextTokens,
        maxTokens: 128000,
      },
    ],
  });
}
register("fixture-secondary", 1050000, 922000);
const observations = [];
for (const prompt of [872000, 64000, 872000]) {
  register("fixture-primary", 1000000, prompt);
  const fork = registry.fork(AuthStorage.inMemory());
  for (const [provider, expected] of [
    ["fixture-primary", prompt],
    ["fixture-secondary", 922000],
  ]) {
    const model = fork.find(provider, id);
    const entries = fork.getAll();
    const state = await createModelSelectionState({
      cfg,
      agentCfg: cfg.agents.defaults,
      defaultProvider: provider,
      defaultModel: id,
      provider,
      model: id,
      hasModelDirective: false,
      preparedModelCatalog: { entries, routeVariants: entries, authoritative: true },
    });
    const early = resolveContextTokens({
      cfg,
      provider: state.provider,
      model: state.model,
      modelContextWindow: state.modelContextWindow,
      modelContextTokens: state.modelContextTokens,
    });
    const maintenanceRow = findModelInCatalog(await state.resolveThinkingCatalog(), provider, id);
    const maintenanceBudget = resolveContextTokens({
      cfg,
      provider,
      model: id,
      modelContextWindow: maintenanceRow?.contextWindow,
      modelContextTokens: maintenanceRow?.contextTokens,
    });
    assert.equal(maintenanceBudget, expected);
    const embedded = resolveEmbeddedRuntimeModelPolicy({
      cfg,
      provider,
      modelId: id,
      runtimeModel: model,
      nativeModelOwned: false,
    });
    assert.equal(early, expected);
    assert.equal(embedded.contextTokenBudget, expected);
    assert.equal(embedded.effectiveModel.maxTokens, 128000);
    observations.push({
      provider,
      model: id,
      native: model.contextWindow,
      prompt: model.contextTokens,
      preReply: early,
      maintenanceBudget,
      maintenanceThreshold: resolveCompactionThreshold({
        contextWindowTokens: maintenanceBudget,
        reserveTokensFloor: 20000,
      }),
      embedded: embedded.contextTokenBudget,
      output: embedded.effectiveModel.maxTokens,
    });
  }
}
console.log(
  JSON.stringify(
    {
      proofKind:
        "real imported source modules, synthetic metadata, isolated state, no provider calls",
      observations,
    },
    null,
    2,
  ),
);
