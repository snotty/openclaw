"""Pinned secretless context continuation proof. All candidate execution stays in CI."""
from pathlib import Path
import json
import re
import subprocess
import sys
root=Path(sys.argv[1]).resolve();out=Path(sys.argv[2]).resolve()
HEAD='006b4ce864f1deafbf6562807841cd8c766126e3'
RED='515b7db47cbb8498f1375658d77d24facc3e2ced'
BASE='e3e2953f4b9a3ef1cd0568763c74c42f33067410'
def git(*args):return subprocess.check_output(['git',*args],cwd=root,text=True).strip()
assert git('rev-parse','HEAD')==HEAD
results={'head':HEAD,'redBase':RED,'mainBase':BASE}
def run(label,args):
 with (out/f'{label}.log').open('w') as log:
  result=subprocess.run(args,cwd=root,stdout=log,stderr=subprocess.STDOUT).returncode
 results[label]=result
 (out/'result.json').write_text(json.dumps(results,indent=2)+'\n')
 print(f'{label}: exit={result}',flush=True)
 return result
files=git('diff','--name-only',RED,HEAD).splitlines()
production=[p for p in files if p.endswith('.ts') and not p.endswith('.test.ts')]
for path in production:
 (root/path).write_bytes(subprocess.check_output(['git','show',f'{RED}:{path}'],cwd=root))
regressions=['src/auto-reply/reply/model-selection.test.ts','src/agents/embedded-agent-runner/run/setup.test.ts','src/agents/embedded-agent-runner/run/terminal-preparation.test.ts','src/config/sessions/context-token-provenance.test.ts']
red=run('red',['node','scripts/run-vitest.mjs',*regressions])
for path in production:
 (root/path).write_bytes(subprocess.check_output(['git','show',f'{HEAD}:{path}'],cwd=root))
log=re.sub(r'\x1b\[[0-9;]*m','',(out/'red.log').read_text())
assert red!=0 and 'resolved-v1' in log and '200000' in log,'missing intended producer/scope RED failures'
assert 'Failed Suites' not in log,'RED collection failure is not a regression proof'
all_tests=list(dict.fromkeys(regressions+[
'src/agents/context.test.ts','src/agents/context.opencode-go.test.ts','src/agents/command/session-store.test.ts',
'src/auto-reply/reply/agent-runner-result-accounting.test.ts','src/auto-reply/reply/agent-runner-memory.test.ts',
'src/auto-reply/reply/agent-runner-memory.preflight-stale-tokens.test.ts','src/auto-reply/reply/memory-flush.test.ts',
'src/auto-reply/reply/reply-state.test.ts','src/auto-reply/reply/agent-runner.media-paths.test.ts',
'src/auto-reply/reply/agent-runner.final-media-runreplyagent.test.ts',
'src/cron/isolated-agent/run.cold-context-budget.test.ts','src/cron/isolated-agent/run.skill-filter.test.ts',
'src/agents/embedded-agent-runner/run/settled-turn-finalization.test.ts',
'src/agents/embedded-agent-runner/run/runtime-preparation.thinking.test.ts',
'src/agents/runtime-plan/credential-scoped-model.memo.test.ts',
'src/agents/embedded-agent-runner/model.test.ts',
]))
if run('green',['node','scripts/run-vitest.mjs',*all_tests]):raise RuntimeError('owner/sibling tests failed')
proof=Path(__file__).with_name('context-upgrade-proof.mts').resolve()
if run('upgrade-proof',['node','--import','./scripts/tsx.mjs',str(proof),str(root)]):raise RuntimeError('production upgrade trace failed')
if run('changed-gates',['node','scripts/check-changed.mjs','--base',BASE]):raise RuntimeError('changed gates failed')
if run('build',['pnpm','build']):raise RuntimeError('serialized full build failed')
if run('diff-check',['git','diff','--check']):raise RuntimeError('diff check failed')
results['status']='passed';(out/'result.json').write_text(json.dumps(results,indent=2)+'\n')
