// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiChatAuthorInfo } from "@gadgets/workshop-shared/api";
import { ComposerModelSelector, type SelectedModel } from "./ComposerModelSelector";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const models: AiChatAuthorInfo[] = [
  { type: "agent", id: "claude-opus-5-5", name: "Claude Opus 5.5" },
];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function renderTriggerLabel(selectedModel: SelectedModel, onRefreshModels?: () => void): string {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(
    <ComposerModelSelector
      models={models}
      selectedModel={selectedModel}
      onModelChange={() => {}}
      onRefreshModels={onRefreshModels}
    />,
  ));
  return container.querySelector('[aria-label="Select model"]')!.textContent!;
}

describe("ComposerModelSelector", () => {
  it("refreshes when opened and shows newly available models without changing the current selection", async () => {
    const refresh = vi.fn<() => void>();
    const change = vi.fn<(id: string | null) => void>();
    const selectedModel = {id: models[0].id};
    renderTriggerLabel(selectedModel, refresh);
    await act(async () => container!.querySelector<HTMLButtonElement>('button')!.click());
    expect(refresh).toHaveBeenCalledOnce();
    await act(async () => root!.render(<ComposerModelSelector
      models={[...models, {type: "agent", id: "opencode-go:new", name: "New Go Model"}]}
      selectedModel={selectedModel} onModelChange={change} onRefreshModels={refresh} />));
    expect(document.body.textContent).toContain("New Go Model");
    expect(container!.querySelector('[aria-label="Select model"]')!.textContent).toBe(models[0].name);
    expect(change).not.toHaveBeenCalled();
  });
  it("labels an offered model by its listed name", () => {
    expect(renderTriggerLabel({ id: "claude-opus-5-5", name: "Stale name" })).toBe("Claude Opus 5.5");
  });

  // An existing chat can still be on a model the picker has since hidden.
  it("labels a model the list doesn't offer by the chat's own name for it", () => {
    expect(renderTriggerLabel({ id: "claude-opus-5", name: "Claude Opus 5" })).toBe("Claude Opus 5");
  });

  it("falls back to the raw id when no name is known", () => {
    expect(renderTriggerLabel({ id: "claude-opus-5" })).toBe("claude-opus-5");
  });
});
