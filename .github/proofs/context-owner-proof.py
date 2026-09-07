"""Secretless, pinned-head supplemental proof; never imports candidate Python tooling."""
import json
from pathlib import Path
import re
import subprocess
import sys

pr, root_arg, output_arg = sys.argv[1:]
root = Path(root_arg).resolve()
output = Path(output_arg).resolve()

def replace_once(path, old, new):
    text = path.read_text()
    if text.count(old) != 1:
        raise RuntimeError(f"Expected one exact source anchor in {path.name}")
    path.write_text(text.replace(old, new))

if pr == "138087":
    test = "src/auto-reply/reply/model-selection.test.ts"
    source = "src/auto-reply/reply/model-selection-context.ts"
    regression = '''

describe("supplemental provider-scoped maintenance", () => {
  it.each(["shared-model", "gpt-6-astra"])("rejects a sibling provider budget for %s", (model) => {
    const cache = getContextWindowCaches().discoveredTokenCache;
    cache.set(model, 922_000);
    cache.set(providerContextTokenCacheKey("fixture-secondary", model), 922_000);
    expect(resolveContextTokens({ cfg: {}, provider: "fixture-primary", model })).toBe(200_000);
    expect(resolveContextTokens({ cfg: {}, provider: "fixture-secondary", model })).toBe(922_000);
    cache.set(providerContextTokenCacheKey("fixture-primary", model), 872_000);
    expect(resolveContextTokens({ cfg: {}, provider: "fixture-primary", model })).toBe(872_000);
  });
});
'''
else:
    if pr != "114891":
        raise RuntimeError("Unsupported PR")
    test = "extensions/microsoft-foundry/index.test.ts"
    source = "extensions/microsoft-foundry/provider.ts"
    regression = '''

describe("supplemental ambiguous manual limits", () => {
  it.each(["selection", "normalization"] as const)("preserves manual limits during %s", async (operation) => {
    const provider = registerProvider();
    const model = {
      ...buildFoundryModel({ id: "manual-alias", name: "gpt-5.4" }),
      params: { canonicalModelId: "gpt-5.4" },
    };
    const config = buildFoundryConfig({ models: [model] });
    if (operation === "selection") {
      await provider.onModelSelected?.({
        config, model: "microsoft-foundry/manual-alias", prompter: {} as never,
        agentDir: defaultFoundryAgentDir,
      });
      expect(config.models.providers["microsoft-foundry"].models[0]).toMatchObject({
        contextWindow: 128_000, maxTokens: 16_384,
      });
    } else {
      expect(provider.normalizeResolvedModel?.({
        provider: "microsoft-foundry", modelId: "manual-alias", model,
      })).toMatchObject({ contextWindow: 128_000, maxTokens: 16_384 });
    }
  });
});
'''

path = root / test
path.write_text(path.read_text() + regression)
command = ["node", "scripts/run-vitest.mjs", test]

def run(label, args):
    with (output / f"{label}.log").open("w") as log:
        code = subprocess.run(args, cwd=root, stdout=log, stderr=subprocess.STDOUT).returncode
    print(f"{label}: exit={code}", flush=True)
    return code

red = run("red", command)
red_log = re.sub(r"\x1b\[[0-9;]*m", "", (output / "red.log").read_text())
if red == 0 or not re.search(r"Tests\s+2 failed", red_log):
    raise RuntimeError("RED did not fail exactly the two intended added regression cases")
if pr == "138087":
    if "expected 922000 to be 200000" not in red_log:
        raise RuntimeError("Unexpected scope failure reason")
    replace_once(root / source, "      allowAsyncLoad: false,\n", "      allowAsyncLoad: false,\n      allowUnscopedModelLookup: false,\n")
else:
    if '"contextWindow": 1050000' not in red_log:
        raise RuntimeError("Unexpected manual-limit failure reason")
    production = (root / source).read_text()
    start = production.index("type FoundryManagedModel = Pick<")
    end = production.index("const openAIResponsesStreamHooks", start)
    # Omit ambiguous runtime repair; capability resolution remains intact.
    (root / source).write_text(production[:start] + production[end:])
    replace_once(root / source, "          ...resolveFoundryManagedModelLimitRepair(model, selectedModelCapabilities),\n", "")
    replace_once(root / source, "        ...resolveFoundryManagedModelLimitRepair(model, capabilities),\n", "")
    # These old assertions described the same ambiguous rows as provider-owned.
    # Preserve their image/API/compatibility coverage while requiring unchanged limits.
    replace_once(path, '''    expect(config.models?.providers?.["microsoft-foundry"]?.models[0]).toMatchObject({
      contextWindow: 1_050_000,
      maxTokens: 128_000,
    });''', '''    expect(config.models?.providers?.["microsoft-foundry"]?.models[0]).toMatchObject({
      contextWindow: 128_000,
      maxTokens: 16_384,
    });''')
    replace_once(path, '''    expect(normalized?.contextWindow).toBe(1_050_000);
    expect(normalized?.maxTokens).toBe(128_000);''', '''    expect(normalized?.contextWindow).toBe(128_000);
    expect(normalized?.maxTokens).toBe(16_384);''')

if run("format", ["pnpm", "exec", "oxfmt", "--write", source, test]):
    raise RuntimeError("Formatter failed")
green = run("green", command)
with (output / "suggested.patch").open("w") as patch:
    subprocess.run(["git", "diff", "--", source, test], cwd=root, stdout=patch, check=True)
diff_check = run("diff-check", ["git", "diff", "--check"])
(output / "result.json").write_text(json.dumps({
    "pr": pr, "head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip(),
    "proof": "secretless hosted source tests; no live provider discovery",
    "redExit": red, "redFailures": 2, "greenExit": green, "diffCheckExit": diff_check,
    "command": command,
}, indent=2) + "\n")
if green or diff_check:
    raise RuntimeError("GREEN or diff check failed")
