import { describe, expect, it } from "vitest";
import {
  resolveProjectedSessionContextTokenBudget,
  resolveProjectedSessionContextTokens,
} from "./context-token-provenance.js";

const currentSelection = {
  provider: "openai",
  model: "gpt-5.6-sol",
  agentHarnessId: "codex",
};

describe("resolveProjectedSessionContextTokens", () => {
  const matchingRuntimeEntry = {
    modelProvider: "openai",
    model: "gpt-5.6-sol",
    agentHarnessId: "codex",
    contextTokens: 272_000,
    contextTokensSource: "runtime" as const,
  };

  it("uses an authored effective cap instead of older matching telemetry", () => {
    expect(
      resolveProjectedSessionContextTokens({
        entry: matchingRuntimeEntry,
        ...currentSelection,
        resolvedContextTokens: 1_000_000,
        authoredContextTokens: 1_000_000,
      }),
    ).toBe(1_000_000);
  });

  it("keeps matching runtime telemetry below a higher native window", () => {
    expect(
      resolveProjectedSessionContextTokens({
        entry: matchingRuntimeEntry,
        ...currentSelection,
        resolvedContextTokens: 1_000_000,
      }),
    ).toBe(272_000);
  });

  it("falls back to current resolution when producer provenance differs", () => {
    expect(
      resolveProjectedSessionContextTokens({
        entry: { ...matchingRuntimeEntry, agentHarnessId: "openclaw" },
        ...currentSelection,
        resolvedContextTokens: 1_000_000,
      }),
    ).toBe(1_000_000);
  });

  it("falls back to the matching persisted resolution while current resolution is unavailable", () => {
    expect(
      resolveProjectedSessionContextTokens({
        entry: { ...matchingRuntimeEntry, contextTokensSource: "resolved-v1" },
        ...currentSelection,
        resolvedContextTokens: undefined,
      }),
    ).toBe(272_000);
  });

  it("rejects a legacy resolved row because its producer may have reused a fallback", () => {
    expect(
      resolveProjectedSessionContextTokens({
        entry: { ...matchingRuntimeEntry, contextTokensSource: "resolved" },
        ...currentSelection,
        resolvedContextTokens: undefined,
      }),
    ).toBeUndefined();
  });

  it("does not resurrect a removed runtime-configured cap while resolution is unavailable", () => {
    expect(
      resolveProjectedSessionContextTokens({
        entry: { ...matchingRuntimeEntry, contextTokensSource: "runtime-configured" },
        ...currentSelection,
        resolvedContextTokens: undefined,
      }),
    ).toBeUndefined();
  });

  it.each([
    { name: "provider", patch: { modelProvider: "openrouter" } },
    { name: "model", patch: { model: "gpt-5.5" } },
    { name: "harness", patch: { agentHarnessId: "openclaw" } },
  ])("rejects a persisted resolution owned by a different $name", ({ patch }) => {
    expect(
      resolveProjectedSessionContextTokens({
        entry: {
          ...matchingRuntimeEntry,
          contextTokensSource: "resolved-v1",
          ...patch,
        },
        ...currentSelection,
        resolvedContextTokens: undefined,
      }),
    ).toBeUndefined();
  });

  it("preserves a locked native window ahead of current configuration", () => {
    expect(
      resolveProjectedSessionContextTokens({
        entry: {
          modelSelectionLocked: true,
          contextTokens: 1_000_000,
        },
        ...currentSelection,
        resolvedContextTokens: 272_000,
        authoredContextTokens: 272_000,
      }),
    ).toBe(1_000_000);
  });

  it.each([
    { name: "provider", patch: { modelProvider: "openrouter" } },
    { name: "model", patch: { model: "gpt-5.5" } },
  ])("rejects a locked window owned by a different $name", ({ patch }) => {
    expect(
      resolveProjectedSessionContextTokens({
        entry: {
          modelProvider: "openai",
          model: "gpt-5.6-sol",
          modelSelectionLocked: true,
          contextTokens: 272_000,
          ...patch,
        },
        ...currentSelection,
        resolvedContextTokens: undefined,
      }),
    ).toBeUndefined();
  });
});

it("honors authored-cap changes and removal for persisted model-owned rows", () => {
  const selection = {
    provider: "fixture-provider",
    model: "fixture-model",
    agentHarnessId: "openclaw",
  };
  const entry = {
    modelProvider: selection.provider,
    model: selection.model,
    agentHarnessId: selection.agentHarnessId,
    contextTokens: 654_321,
    contextTokensSource: "resolved-v1" as const,
  };
  const project = (authoredContextTokens?: number) =>
    resolveProjectedSessionContextTokenBudget({
      entry,
      ...selection,
      resolvedContextTokens: 654_321,
      resolvedContextTokensSource: "resolved-v1",
      authoredContextTokens,
    });
  expect(project(64_000)).toEqual({ contextTokens: 64_000, contextTokensSource: "resolved" });
  expect(project(96_000)).toEqual({ contextTokens: 96_000, contextTokensSource: "resolved" });
  expect(project()).toEqual({ contextTokens: 654_321, contextTokensSource: "resolved-v1" });
  const capped = project(64_000)!;
  expect(
    resolveProjectedSessionContextTokenBudget({
      entry: { ...entry, ...capped },
      ...selection,
      resolvedContextTokens: undefined,
    }),
  ).toBeUndefined();
});
