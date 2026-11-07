import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import { readProviderJson as readJson } from "./provider-json.js";

const API_ROOT = "https://api.anthropic.com";
const TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
// The beta header unlocks Claude-plan inference over the standard Anthropic Messages API with a
// Bearer token (Authorization instead of x-api-key).
const OAUTH_BETA = "oauth-2025-04-20";
// The credentials file names the public client the helper signed in with, so a renewed flow can
// keep using it without this file changing.
const clientSchema = z.string().regex(/^[0-9a-f-]{8,64}$/);

const credentialsSchema = z.object({
  client_id: clientSchema,
  access_token: z.string().min(1).max(16384),
  refresh_token: z.string().min(1).max(16384),
  // Epoch milliseconds; the helper computes it from the token response's expires_in.
  expires_at: z.number().int().positive(),
});

type Credentials = z.infer<typeof credentialsSchema> & {email?: string};

/** The headers every Claude-plan request takes, over the helper's stored OAuth credentials. */
async function oauthHeaders(token: string): Promise<Record<string, string>> {
  return {
    Authorization: `Bearer ${token}`,
    "anthropic-version": "2023-06-01",
    "anthropic-beta": OAUTH_BETA,
  };
}

/** Private capability-addressed credential store; never bound to a public route. */
export class ClaudeConnection extends DurableObject<Cloudflare.Env> {
  #refresh?: Promise<string>;
  #revoked = false;

  async initialize(json: string): Promise<{email?: string; models: {id: string; name: string}[]}> {
    if (json.length > 65536) throw new Error("Claude credential file is too large.");
    const input = credentialsSchema.parse(JSON.parse(json));
    // The tokens are opaque, so validation is behavioral: a plan-grade profile read and a model
    // list are both only possible with a live, inference-capable authorization.
    const profile = await fetch(`${API_ROOT}/v1/me`, {
      headers: await oauthHeaders(input.access_token),
      signal: AbortSignal.timeout(30000), redirect: "manual",
    });
    if (!profile.ok) throw new Error(`Unable to read the Claude profile (${profile.status}).`);
    const identity = z.object({email: z.email().max(256).optional()})
        .parse(await readJson(profile));
    const response = await fetch(`${API_ROOT}/v1/models`, {
      headers: await oauthHeaders(input.access_token),
      signal: AbortSignal.timeout(30000), redirect: "manual",
    });
    if (!response.ok) throw new Error(`Unable to list Claude models (${response.status}).`);
    const catalog = z.object({data: z.array(z.object({
      id: z.string().min(1).max(256), display_name: z.string().max(256),
    })).min(1).max(256)}).parse(await readJson(response));
    const models = catalog.data.map(model => ({id: model.id, name: model.display_name}));
    await this.#refresh;
    await this.ctx.storage.put("credentials", {
      ...input, email: identity.email,
    } satisfies Credentials);
    return {email: identity.email, models};
  }

  async disconnect(): Promise<boolean> {
    this.#revoked = true;
    try { await this.#refresh; } catch { /* Revocation still removes expired credentials. */ }
    const saved = await this.ctx.storage.get<Credentials>("credentials");
    await this.ctx.storage.deleteAll();
    // Anthropic's OAuth server publishes no revocation endpoint, so there is nothing remote to
    // confirm: the local copy is the only one this app holds.
    return !!saved;
  }

  async #token(): Promise<string> {
    if (this.#revoked) throw new Error("Reconnect Claude from AI Providers.");
    if (this.#refresh) return this.#refresh;
    const saved = await this.ctx.storage.get<Credentials>("credentials");
    if (!saved) throw new Error("Reconnect Claude from AI Providers.");
    if (saved.expires_at > Date.now() + 60000) return saved.access_token;
    // One in-flight rotation per account, without holding the input gate over network I/O.
    if (!this.#refresh) this.#refresh = this.#renew(saved).finally(() => { this.#refresh = undefined; });
    return this.#refresh;
  }

  async #renew(saved: Credentials): Promise<string> {
    const response = await fetch(TOKEN_URL, {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(15000),
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({grant_type: "refresh_token", client_id: saved.client_id,
        refresh_token: saved.refresh_token}),
    });
    if (!response.ok) {
      throw new Error(`Claude authorization expired; reconnect from AI Providers (${response.status}).`);
    }
    const renewed = z.object({access_token: z.string().min(1).max(16384),
      refresh_token: z.string().min(1).max(16384), expires_in: z.number().positive()})
        .parse(await readJson(response));
    saved = {...saved, access_token: renewed.access_token, refresh_token: renewed.refresh_token,
      expires_at: Date.now() + renewed.expires_in * 1000};
    await this.ctx.storage.put("credentials", saved);
    if (this.#revoked) throw new Error("Reconnect Claude from AI Providers.");
    return saved.access_token;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.origin !== API_ROOT ||
        !url.pathname.startsWith("/v1/") || url.pathname.endsWith("/models")) {
      return new Response("Not found", {status: 404});
    }
    const token = await this.#token();
    if (this.#revoked) throw new Error("Reconnect Claude from AI Providers.");
    const headers = {Authorization: `Bearer ${token}`, "Content-Type": "application/json",
      "anthropic-version": request.headers.get("anthropic-version") ?? "2023-06-01",
      "anthropic-beta": request.headers.get("anthropic-beta") ?? OAUTH_BETA};
    return fetch(url, {
      method: "POST", headers, body: await request.text(),
      redirect: "manual", signal: request.signal,
    });
  }
}
