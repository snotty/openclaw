// Docs i18n tests cover the Go module backing docs translation.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const hasGoToolchain = spawnSync("go", ["version"], { encoding: "utf8" }).status === 0;

// The translator derives its isolated CODEX_HOME from os.UserCacheDir()
// (XDG_CACHE_HOME first on Linux), and translator_test.go asserts it is not
// under /tmp. The isolated vitest test home points XDG_CACHE_HOME under
// os.tmpdir(), so give the Go child a stable cache dir inside the repo's
// ignored .artifacts scratch instead. Reused across runs on purpose: it also
// holds the go-build cache, and Go cache files are read-only, so a fresh
// mkdtemp-per-run would leak undeletable directories.
const goCacheDir = path.resolve(".artifacts", "docs-i18n-cache");
fs.mkdirSync(goCacheDir, { recursive: true });

describe.skipIf(!hasGoToolchain)("docs-i18n Go module", () => {
  it("passes Go tests", () => {
    const result = spawnSync("go", ["test", "./...", "-count=1"], {
      cwd: "scripts/docs-i18n",
      encoding: "utf8",
      env: { ...process.env, XDG_CACHE_HOME: goCacheDir },
    });

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr || result.stdout).toBe(0);
  });
});
