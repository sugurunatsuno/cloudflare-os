import { z } from "zod";
import { OPENCODE_GO_MODELS } from "@earendil-works/pi-ai/providers/opencode-go.models";
import type { Api, Model } from "@earendil-works/pi-ai";
import { SUGGESTED_MODELS, type OpenCodeGoApi } from "@gadgets/workshop-shared/api";
import { readProviderJson } from "./provider-json.js";

export const OPENCODE_GO_MODELS_URL = "https://opencode.ai/inference/go/v1/models";
export const OPENCODE_GO_METADATA_URL = "https://models.dev/api.json";
export const OPENCODE_GO_REFRESH_MS = 5 * 60 * 1000;

export type OpenCodeGoModel = {
  id: string; name: string; api: OpenCodeGoApi; contextWindow: number; outputLimit: number;
};
export type OpenCodeGoConnection = {
  id: string; apiToken: string; modelIds: string[]; activeModelIds: string[]; updatedAt: number;
};

// Native Go protocols from https://opencode.ai/docs/go/#endpoints, while metadata is unavailable.
const FALLBACK_APIS: Partial<Record<string, OpenCodeGoApi>> = {
  "gpt-6-luna": "openai-responses", "gpt-5.6-luna": "openai-responses",
  "grok-4.7": "openai-responses", "muse-spark-1.2-contributor": "openai-responses",
  "muse-spark-1.3-contributor": "openai-responses", "claude-haiku-5-5": "anthropic-messages",
  "minimax-m3": "anthropic-messages", "qwen3.8-max": "anthropic-messages",
  "qwen3.8-flash": "anthropic-messages", "qwen3.7-plus": "anthropic-messages",
  "gemini-4-argon-contributor": "google-generative-ai",
};
const SDK_APIS: Record<string, OpenCodeGoApi> = {
  "@ai-sdk/openai": "openai-responses", "@ai-sdk/openai-compatible": "openai-completions",
  "@ai-sdk/anthropic": "anthropic-messages", "@ai-sdk/google": "google-generative-ai",
};
const BUILTIN_MODELS: Partial<Record<string, Model<Api>>> = OPENCODE_GO_MODELS;
const own = (value: unknown, key: string): unknown => value !== null && typeof value === "object" &&
  Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined;

/** Last-known protocol for saved/custom models when live metadata isn't available. */
export function openCodeGoApi(id: string): OpenCodeGoApi {
  const entry = Object.hasOwn(BUILTIN_MODELS, id) ? BUILTIN_MODELS[id] : undefined;
  // ponytail: unknown IDs without metadata use chat completions until the metadata catalog catches up.
  return FALLBACK_APIS[id] && Object.hasOwn(FALLBACK_APIS, id) ? FALLBACK_APIS[id]! :
    (entry?.api as OpenCodeGoApi | undefined) ?? "openai-completions";
}

const modelSchema = z.object({
  id: z.string().trim().min(1).max(200), name: z.string().min(1).max(200).optional(),
  provider: z.object({npm: z.string().optional()}).optional(),
  limit: z.object({context: z.number().int().positive(), output: z.number().int().positive()}).optional(),
});

/** The official availability list is authoritative; metadata only supplies labels, limits and protocols. */
export function parseOpenCodeGoModels(list: unknown, metadata: unknown,
                                    previous: readonly OpenCodeGoModel[] = []): OpenCodeGoModel[] {
  const {data} = z.object({data: z.array(z.object({id: z.string().trim().min(1).max(200)}))
    .min(1).max(1000)}).parse(list);
  const provider = own(metadata, "opencode-go");
  const defaults = own(provider, "npm");
  const previousById = new Map(previous.map(model => [model.id, model]));
  return [...new Set(data.map(model => model.id))].map(id => {
    const parsed = modelSchema.safeParse(own(own(provider, "models"), id));
    const entry = parsed.success && parsed.data.id === id ? parsed.data : undefined;
    const saved = previousById.get(id);
    const builtin = Object.hasOwn(BUILTIN_MODELS, id) ? BUILTIN_MODELS[id] : undefined;
    const suggested = Object.hasOwn(SUGGESTED_MODELS["opencode-go"], id)
      ? SUGGESTED_MODELS["opencode-go"][id] : undefined;
    const npm = entry?.provider?.npm ?? (entry ? defaults : undefined);
    const api = typeof npm === "string" && Object.hasOwn(SDK_APIS, npm) ? SDK_APIS[npm] : undefined;
    const contextWindow = entry?.limit?.context ?? saved?.contextWindow ??
      suggested?.contextWindow ?? builtin?.contextWindow ?? 128000;
    const output = entry?.limit?.output ?? saved?.outputLimit ?? suggested?.outputLimit ?? builtin?.maxTokens ?? 4096;
    // ponytail: reserve half the window for prompts; add per-model budgeting if this cap constrains turns.
    return {id, name: entry?.name ?? saved?.name ?? builtin?.name ?? id,
      api: api ?? saved?.api ?? openCodeGoApi(id), contextWindow,
      outputLimit: Math.min(output, Math.max(1, Math.floor(contextWindow / 2)))};
  });
}

async function download(url: string, maxBytes: number): Promise<unknown> {
  const response = await fetch(url, {redirect: "manual", signal: AbortSignal.timeout(8000),
    headers: {"User-Agent": "CloudflareOS/1.0"}});
  if (!response.ok) throw new Error(`Model catalog answered ${response.status}.`);
  return readProviderJson(response, maxBytes);
}

/** Fetch public catalogs without sending any user's key to either catalog endpoint. */
export async function fetchOpenCodeGoModels(previous: readonly OpenCodeGoModel[] = []): Promise<OpenCodeGoModel[]> {
  const [list, metadata] = await Promise.all([
    download(OPENCODE_GO_MODELS_URL, 256 * 1024),
    download(OPENCODE_GO_METADATA_URL, 16 * 1024 * 1024).catch(() => null),
  ]);
  return parseOpenCodeGoModels(list, metadata, previous);
}
