# Supplemental context-owner evidence — September 7, 2026

These are suggested patches for existing PR owners, not replacement PRs or changes to their branches.

Hosted verification: https://github.com/snotty/openclaw/actions/runs/34096134255

- `pr-138087-scoped-maintenance.patch` applies to `c06ccf0665b24353b030193d8b2006f6ec5b68fd`. Two new provider-collision cases failed on that exact head; the one-line scope fix made all 76 model-selection tests pass. Synthetic providers share either a generic model name or the public Astra model id but have different budgets. No live discovery was performed.
- `pr-114891-preserve-manual-limits.patch` applies to `5f86a9affe7816f0a578ebadb51b59e0d487de49`. Two new manual-limit cases failed on that exact head; removing the ambiguous runtime rewrite made all 116 Foundry index tests pass. The patch preserves the fresh-discovery capability changes. Two older assertions are updated because the input shape does not establish who authored those limits; their API/image/compatibility checks remain intact.

Both patches passed formatter and `git diff --check` in secretless GitHub-hosted jobs. Logs and exact-head records are attached to the run. This proves the named source/test boundaries, not live provider discovery, full repository gates on these old PR heads, or maintainer approval.

The workflow/bootstrap and patches contain only public source and synthetic fixtures. No operator configuration, credentials, accounts, transcripts, or private resource identifiers are included. Original contributor branches remain unchanged and neither PR was merged.
