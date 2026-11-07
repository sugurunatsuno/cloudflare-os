import { DurableObject } from "cloudflare:workers";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import { readProviderJson as readJson } from "./provider-json.js";

const ISSUER = "https://auth.openai.com";
const RESOURCE = "https://api.openai.com/v1";
const jwks = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));
const credentialsSchema = z.object({
  client_id: z.string().startsWith("oaiapp_").max(256),
  ext_agent_host_id: z.string().min(1).max(256),
  access_token: z.string().min(1).max(16384),
  refresh_token: z.string().min(1).max(16384),
  id_token: z.string().min(1).max(16384),
});
type Credentials = z.infer<typeof credentialsSchema> & {
  expiresAt: number; subject: string; email?: string;
};

/** Enforce the official ChatGPT-plan Responses contract after the SDK builds its request. */
export function chatGptPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...payload, store: false, stream: true };
  for (const key of ["background", "conversation", "max_output_tokens", "max_tool_calls",
    "metadata", "moderation", "multi_agent", "prompt", "prompt_cache_retention",
    "safety_identifier", "temperature", "top_logprobs", "top_p", "truncation", "user",
    "previous_response_id"]) delete result[key];
  if (Array.isArray(result.input)) {
    result.input = result.input.map(item => item?.role === "system"
      ? { ...item, role: "developer" }
      : item?.type === "function_call" || item?.type === "custom_tool_call"
        ? {...item, namespace: "workshop"} : item);
  }
  if (Array.isArray(result.tools)) {
    const tools = result.tools as {type: string}[];
    if (tools.some(tool => tool.type !== "function" && tool.type !== "custom")) {
      throw new Error("This tool is not supported by ChatGPT plan usage.");
    }
    if (tools.length) result.tools = [{type: "namespace", name: "workshop", tools}];
  }
  return result;
}

/** Private capability-addressed credential store; never bound to a public route. */
export class ChatGptConnection extends DurableObject<Cloudflare.Env> {
  #refresh?: Promise<string>;
  #revoked = false;
  async initialize(json: string): Promise<{email?: string; models: {id: string; name: string}[]}> {
    if (json.length > 65536) throw new Error("ChatGPT credential file is too large.");
    const input = credentialsSchema.parse(JSON.parse(json));
    const identity = await jwtVerify(input.id_token, jwks, {
      issuer: ISSUER, audience: input.client_id, requiredClaims: ["sub", "exp", "iat"], clockTolerance: 5,
    });
    const access = await jwtVerify(input.access_token, jwks, {
      issuer: ISSUER, audience: RESOURCE, requiredClaims: ["sub", "exp", "scope"], clockTolerance: 5,
    });
    if (typeof identity.payload.sub !== "string" || !identity.payload.sub ||
        access.payload.sub !== identity.payload.sub || access.payload.client_id !== input.client_id ||
        typeof access.payload.scope !== "string" ||
        !access.payload.scope.split(" ").includes("chatgpt.tokens.use.direct")) {
      throw new Error("ChatGPT plan usage was not authorized for this account.");
    }
    const response = await fetch(`${RESOURCE}/models`, {
      headers: {Authorization: `Bearer ${input.access_token}`},
      signal: AbortSignal.timeout(30000), redirect: "manual",
    });
    if (!response.ok) throw new Error(`Unable to list ChatGPT models (${response.status}).`);
    const catalog = z.object({models: z.array(z.object({
      slug: z.string().min(1).max(256), display_name: z.string().max(256), visibility: z.string(),
    })).max(256)}).parse(await readJson(response));
    const models = catalog.models.filter(model => model.visibility === "list")
      .map(model => ({id: model.slug, name: model.display_name}));
    if (!models.length) throw new Error("This ChatGPT account has no available models.");
    const email = typeof identity.payload.email === "string" ? identity.payload.email : undefined;
    await this.#refresh;
    await this.ctx.storage.put("credentials", {
      ...input, subject: identity.payload.sub, email, expiresAt: access.payload.exp! * 1000,
    } satisfies Credentials);
    return {email, models};
  }

  async disconnect(): Promise<boolean> {
    this.#revoked = true;
    try { await this.#refresh; } catch { /* Revocation still removes expired credentials. */ }
    const saved = await this.ctx.storage.get<Credentials>("credentials");
    let revoked = !saved;
    if (saved) {
      try {
        const discovery = await fetch(`${ISSUER}/.well-known/openid-configuration`, {
          redirect: "manual", signal: AbortSignal.timeout(10000),
        });
        if (!discovery.ok) throw new Error("Discovery failed");
        const config = z.object({revocation_endpoint: z.url()}).parse(await readJson(discovery));
        const endpoint = new URL(config.revocation_endpoint);
        if (endpoint.origin !== ISSUER || endpoint.username || endpoint.password) throw new Error("Invalid issuer endpoint");
        const response = await fetch(endpoint, {
          method: "POST", redirect: "manual", signal: AbortSignal.timeout(10000),
          body: new URLSearchParams({token: saved.refresh_token, token_type_hint: "refresh_token",
            client_id: saved.client_id}),
        });
        revoked = response.status === 200;
      } catch { /* Local disconnection proceeds even when remote revocation is unavailable. */ }
    }
    await this.ctx.storage.deleteAll();
    return revoked;
  }

  async #token(): Promise<string> {
    if (this.#revoked) throw new Error("Reconnect ChatGPT from AI Providers.");
    if (this.#refresh) return this.#refresh;
    const saved = await this.ctx.storage.get<Credentials>("credentials");
    if (!saved || this.#revoked) throw new Error("Reconnect ChatGPT from AI Providers.");
    if (saved.expiresAt > Date.now() + 60000) return saved.access_token;
    // One in-flight rotation per account, without holding the input gate over network I/O.
    if (!this.#refresh) this.#refresh = this.#renew(saved).finally(() => { this.#refresh = undefined; });
    return this.#refresh;
  }

  async #renew(saved: Credentials): Promise<string> {
    const response = await fetch(`${ISSUER}/api/accounts/oauth/token`, {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(15000),
      body: new URLSearchParams({grant_type: "refresh_token", client_id: saved.client_id,
        refresh_token: saved.refresh_token, resource: RESOURCE}),
    });
    if (!response.ok) throw new Error(`ChatGPT authorization expired; reconnect (${response.status}).`);
    const renewed = z.object({access_token: z.string().max(16384), refresh_token: z.string().max(16384),
      scope: z.string(), expires_in: z.number().positive()}).parse(await readJson(response));
    const verified = await jwtVerify(renewed.access_token, jwks, {
      issuer: ISSUER, audience: RESOURCE, requiredClaims: ["sub", "exp", "scope"], clockTolerance: 5,
    });
    if (verified.payload.sub !== saved.subject || verified.payload.client_id !== saved.client_id ||
        typeof verified.payload.scope !== "string" ||
        !verified.payload.scope.split(" ").includes("chatgpt.tokens.use.direct") ||
        !renewed.scope.split(" ").includes("chatgpt.tokens.use.direct")) {
      throw new Error("ChatGPT authorization changed; reconnect from AI Providers.");
    }
    saved = {...saved, ...renewed, expiresAt: verified.payload.exp! * 1000};
    await this.ctx.storage.put("credentials", saved);
    if (this.#revoked) throw new Error("Reconnect ChatGPT from AI Providers.");
    return saved.access_token;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/v1/responses") {
      return new Response("Not found", {status: 404});
    }
    const token = await this.#token();
    const payload = chatGptPayload(await request.json<Record<string, unknown>>());
    if (this.#revoked) throw new Error("Reconnect ChatGPT from AI Providers.");
    return fetch(`${RESOURCE}/responses`, {
      method: "POST", headers: {Authorization: `Bearer ${token}`, "Content-Type": "application/json"},
      body: JSON.stringify(payload), redirect: "manual", signal: request.signal,
    });
  }
}
