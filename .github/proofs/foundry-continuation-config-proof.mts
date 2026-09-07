import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
let stage = "initialization";
async function main() {
  const root = resolve(process.argv[2]);
  const baseline = resolve(process.argv[3]);
  const state = process.env.OPENCLAW_STATE_DIR;
  assert(
    state && state.includes("astra-continuations-20260907"),
    "explicit isolated state required",
  );
  const az = resolve(process.env.HOME!, ".local/bin/az");
  assert.equal(execFileSync("which", ["az"], { encoding: "utf8" }).trim(), az);
  const cli = (args: string[]) =>
    JSON.parse(
      execFileSync(az, [...args, "--output", "json"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 90000,
      }),
    );
  stage = "read-only account/resource discovery";
  const account = cli(["account", "show", "--query", "{id:id}"]);
  const resources = cli([
    "cognitiveservices",
    "account",
    "list",
    "--subscription",
    account.id,
    "--query",
    "[].{name:name,kind:kind,resourceGroup:resourceGroup}",
  ]);
  const load = (folder: string, path: string) => import(pathToFileURL(`${folder}/${path}`).href);
  const { listResourceDeployments } = await load(root, "extensions/microsoft-foundry/onboard.ts");
  const after = await load(root, "extensions/microsoft-foundry/shared.ts");
  const before = await load(baseline, "extensions/microsoft-foundry/shared.ts");
  const { buildMicrosoftFoundryProvider } = await load(
    root,
    "extensions/microsoft-foundry/provider.ts",
  );
  const { applyProviderAuthConfigPatch } = await load(
    root,
    "src/plugins/provider-auth-choice-helpers.ts",
  );
  stage = "production deployment discovery";
  let observed: any;
  for (const resource of resources) {
    if (!["OpenAI", "AIServices"].includes(resource.kind)) continue;
    const deployments = listResourceDeployments(
      {
        accountName: resource.name,
        resourceGroup: resource.resourceGroup,
        kind: resource.kind,
        projects: [],
      },
      account.id,
    );
    const match = deployments.find(
      (deployment: any) =>
        deployment.modelName === "gpt-5-mini" && deployment.state === "Succeeded",
    );
    if (match) {
      observed = { ...match, resourceKind: resource.kind };
      break;
    }
  }
  assert(
    observed,
    "no successful public GPT-5-mini found through production listResourceDeployments",
  );
  // Discovery has completed. Only the public canonical model name/version and a
  // pseudonym leave this boundary. Endpoint/profile are synthetic and no credential is persisted.
  const deployment = { name: "deployment-redacted", modelName: observed.modelName };
  const setup = {
    profileId: "microsoft-foundry:proof",
    apiKey: "__entra_id_dynamic__",
    endpoint: "https://example.services.ai.azure.com",
    modelId: deployment.name,
    modelNameHint: deployment.modelName,
    api: "openai-responses",
    authMethod: "entra-id",
    deployments: [deployment],
  };
  const provider = (result: any) => result.configPatch.models.providers["microsoft-foundry"];
  const get = (config: any) => config.models.providers["microsoft-foundry"];
  const limits = (model: any) => ({
    contextWindow: model.contextWindow,
    ...(model.contextTokens === undefined ? {} : { contextTokens: model.contextTokens }),
    maxTokens: model.maxTokens,
  });
  stage = "isolated before/after config generation";
  const old = provider(before.buildFoundryAuthResult(setup));
  const freshResult = after.buildFoundryAuthResult(setup);
  const fresh = applyProviderAuthConfigPatch({}, freshResult.configPatch);
  const freshProvider = get(fresh);
  assert.deepEqual(limits(old.models[0]), { contextWindow: 128000, maxTokens: 16384 });
  assert.deepEqual(limits(freshProvider.models[0]), { contextWindow: 400000, maxTokens: 128000 });
  const repeated = applyProviderAuthConfigPatch(
    fresh,
    after.buildFoundryAuthResult({ ...setup, currentProviderConfig: freshProvider }).configPatch,
  );
  assert.deepEqual(get(repeated).models, freshProvider.models);
  const intentional = { ...old, models: [{ ...old.models[0], contextTokens: 64000 }] };
  const repeatedCapped = applyProviderAuthConfigPatch(
    { models: { providers: { "microsoft-foundry": intentional } } },
    after.buildFoundryAuthResult({ ...setup, currentProviderConfig: intentional }).configPatch,
  );
  assert.deepEqual(limits(get(repeatedCapped).models[0]), {
    contextWindow: 128000,
    contextTokens: 64000,
    maxTokens: 16384,
  });
  stage = "existing selection and normalization";
  const existing = { models: { providers: { "microsoft-foundry": structuredClone(old) } } };
  const hooks = buildMicrosoftFoundryProvider();
  await hooks.onModelSelected({
    config: existing,
    model: "microsoft-foundry/deployment-redacted",
    prompter: {},
    agentDir: resolve(state, "agent"),
  });
  assert.deepEqual(limits(get(existing).models[0]), { contextWindow: 128000, maxTokens: 16384 });
  const normalized = hooks.normalizeResolvedModel({
    provider: "microsoft-foundry",
    modelId: deployment.name,
    model: get(existing).models[0],
  });
  assert.deepEqual(limits(normalized), { contextWindow: 128000, maxTokens: 16384 });
  const syntheticAlias = provider(
    after.buildFoundryAuthResult({
      ...setup,
      modelId: "synthetic-custom-alias",
      deployments: [{ ...deployment, name: "synthetic-custom-alias" }],
    }),
  );
  assert.deepEqual(limits(syntheticAlias.models[0]), { contextWindow: 400000, maxTokens: 128000 });
  const report = {
    observedAt: new Date().toISOString(),
    source:
      "real authenticated production listResourceDeployments -> canonical model -> buildFoundryAuthResult -> applyProviderAuthConfigPatch; isolated generated state only",
    discovery: {
      deploymentName: "redacted",
      deploymentNameEqualsCanonical: observed.name === observed.modelName,
      canonicalModel: observed.modelName,
      version: observed.modelVersion,
      state: observed.state,
      sku: observed.sku,
      resourceKind: observed.resourceKind,
    },
    documentedContract: {
      source:
        "https://learn.microsoft.com/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure#gpt-5",
      native: 400000,
      maximumInput: 272000,
      maximumOutput: 128000,
    },
    before: limits(old.models[0]),
    freshGenerated: limits(freshProvider.models[0]),
    repeatedFresh: limits(get(repeated).models[0]),
    repeatedDeliberateCap: limits(get(repeatedCapped).models[0]),
    existingSelection: limits(get(existing).models[0]),
    existingRuntimeNormalization: limits(normalized),
    syntheticCustomAlias: { synthetic: true, limits: limits(syntheticAlias.models[0]) },
    inferenceCapacityTested: false,
    authLoginExecuted: false,
    persistedOperatorStateChanged: false,
    limitation:
      "real deployment name equals canonical name; distinct custom alias is synthetic. Limits are documentation-derived configuration, not service-discovered capacities or tested million-token inference. Ambiguous existing caps intentionally remain unchanged.",
  };
  mkdirSync(state, { recursive: true });
  writeFileSync(
    resolve(state, "generated-config.json"),
    JSON.stringify({ models: fresh.models }, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
}
main().catch((error) => {
  console.error(
    JSON.stringify({
      blocked: true,
      stage,
      errorType: error?.name,
      code: error?.code,
      details:
        "Raw errors suppressed to protect private Azure identifiers; no login or writes attempted.",
    }),
  );
  process.exitCode = 1;
});
