# Foundry Codex Max reasoning contract caveat

Checked against both current rendered Microsoft pages on September 7, 2026 (11:34 UTC), not only search snippets.

- [Model-specific GPT-5.1 capability page](https://learn.microsoft.com/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure#gpt-51): “Reasoning effort `none` is not supported with `gpt-5.1-codex-max`.”
- [General reasoning guide, API and feature support, footnote 7](https://learn.microsoft.com/azure/foundry/openai/how-to/reasoning#api-and-feature-support): includes `gpt-5.1-codex-max` among models that support `'None'`.

These currently conflict. The isolated original-author hunk in commit `3caa66851f6d1133a6f24e53ccd4cb66d54dd95b` follows the model-specific exclusion and retains the other existing effort values. Its test proves configuration matches that chosen contract; it does not independently prove the service's accepted effort enum.

Read-only discovery found no existing GPT-5.1 Codex Max deployment available for a targeted live check. No model was provisioned and no inference call was made. Leave this separately cherry-pickable hunk to maintainer review rather than calling the discrepancy resolved or silently changing authentication/resources to test it.

The real GPT-5-mini discovery/config-generation proof and native/output mapping tests are separate and unaffected. No inference capacity or million-token claim is made.
