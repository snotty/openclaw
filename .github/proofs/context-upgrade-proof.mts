import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const root = resolve(process.argv[2]);
const load = (path: string) => import(pathToFileURL(`${root}/${path}`).href);
assert(process.env.OPENCLAW_STATE_DIR, "isolated app state is required");
const storePath = resolve(process.env.OPENCLAW_STATE_DIR!, "agents/main/sessions/sessions.json");
const selection = {
  provider: "fixture-discovery",
  model: "fixture-model",
  agentHarnessId: "openclaw",
};
const sessionKey = "agent:main:explicit:upgrade-proof";
const sessionId = "upgrade-proof";
const accessor = await load("src/config/sessions/session-accessor.ts");
const { resolveProjectedSessionContextTokenBudget: project } = await load(
  "src/config/sessions/context-token-provenance.ts",
);
if (process.argv[3] === "cold") {
  const entry = accessor.loadSessionEntry({ storePath, sessionKey });
  const cold = project({ entry, ...selection, resolvedContextTokens: undefined });
  assert.deepEqual(cold, { contextTokens: 654321, contextTokensSource: "resolved-v1" });
  const legacy = project({
    entry: { ...entry, contextTokensSource: "resolved" },
    ...selection,
    resolvedContextTokens: undefined,
  });
  assert.equal(legacy, undefined);
  const mismatch = ["provider", "model", "agentHarnessId"].map(
    (key) =>
      project({
        entry,
        ...selection,
        [key]: "different-owner",
        resolvedContextTokens: undefined,
      }) ?? null,
  );
  assert.deepEqual(mismatch, [null, null, null]);
  const caps = [64000, 96000, undefined].map((authoredContextTokens) =>
    project({
      entry,
      ...selection,
      resolvedContextTokens: 654321,
      resolvedContextTokensSource: "resolved-v1",
      authoredContextTokens,
    }),
  );
  assert.deepEqual(
    caps.map((value) => value.contextTokens),
    [64000, 96000, 654321],
  );
  const removedColdCap = project({
    entry: { ...entry, ...caps[0] },
    ...selection,
    resolvedContextTokens: undefined,
  });
  assert.equal(removedColdCap, undefined);
  console.log(
    JSON.stringify({
      cold,
      legacy: legacy ?? null,
      providerModelHarnessMismatch: mismatch,
      authoredCapChangeRemoval: caps,
      removedColdCap: removedColdCap ?? null,
    }),
  );
} else {
  mkdirSync(resolve(storePath, ".."), { recursive: true });
  const { replaceDiscoveredContextTokenCache, providerContextTokenCacheKey } = await load(
    "src/agents/context-cache.ts",
  );
  replaceDiscoveredContextTokenCache(
    new Map([[providerContextTokenCacheKey(selection.provider, selection.model), 654321]]),
  );
  const entry = { sessionId, updatedAt: 1, agentHarnessId: selection.agentHarnessId };
  await accessor.patchSessionEntryCore({ storePath, sessionKey }, () => entry, {
    fallbackEntry: entry,
    replaceEntry: true,
    skipMaintenance: true,
  });
  const sessionStore = { [sessionKey]: entry };
  const { updateSessionStoreAfterAgentRun } = await load("src/agents/command/session-store.ts");
  await updateSessionStoreAfterAgentRun({
    cfg: {},
    sessionId,
    sessionKey,
    storePath,
    sessionStore,
    agentDir: resolve(process.env.OPENCLAW_STATE_DIR!, "agents/main/agent"),
    defaultProvider: selection.provider,
    defaultModel: selection.model,
    result: { meta: { durationMs: 1, agentMeta: { sessionId, ...selection } } },
  });
  const persisted = accessor.loadSessionEntry({ storePath, sessionKey });
  assert.equal(persisted.contextTokens, 654321);
  assert.equal(persisted.contextTokensSource, "resolved-v1");
  const { closeOpenClawAgentDatabasesForTest } = await load("src/state/openclaw-agent-db.ts");
  closeOpenClawAgentDatabasesForTest();
  const cold = JSON.parse(
    execFileSync(
      process.execPath,
      ["--import", `${root}/scripts/tsx.mjs`, process.argv[1], root, "cold"],
      { env: process.env, encoding: "utf8" },
    ),
  );
  const { resolveContextTokensForModelFromCache } = await load("src/agents/context-resolution.ts");
  const stale = resolveContextTokensForModelFromCache(
    {
      cfg: {},
      provider: selection.provider,
      model: selection.model,
      modelContextTokens: 872000,
      modelContextWindow: 1000000,
    },
    () => 128000,
    () => undefined,
  );
  assert.equal(stale, 128000);
  console.log(
    JSON.stringify(
      {
        proof:
          "production discovery projection -> command accounting -> real isolated SQLite -> fresh cold Node process; synthetic model metadata, no provider inference",
        warm: {
          contextTokens: persisted.contextTokens,
          contextTokensSource: persisted.contextTokensSource,
        },
        ...cold,
        unresolvedScalarCachePrecedence: {
          cached: 128000,
          supplied: 872000,
          result: stale,
          limitation:
            "caller numbers carry no selected credential provenance; retained conservative behavior, not fixed by guessing max",
        },
      },
      null,
      2,
    ),
  );
}
