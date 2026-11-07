import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import { readProviderJson as readJson } from "./provider-json.js";

// GitHub's token endpoints, and the API root the Copilot token names for each account's inference.
const GITHUB_ROOT = "https://github.com";
const GITHUB_API_ROOT = "https://api.github.com";
// The public client of GitHub's Copilot CLI, whose device flow any tool may run: it asks only for
// the user's own Copilot plan.
const CLIENT_ID = "Iv1.b507a08c87ecfe98";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
// Copilot's API refuses a request without an integration identity.
const INTEGRATION_HEADERS = {"Copilot-Integration-Id": "vscode-chat", "Editor-Version": "CloudflareOS/1.0"};

const modelsSchema = z.object({data: z.array(z.object({
  id: z.string().min(1).max(256), name: z.string().max(256).optional(),
})).min(1).max(256)});

type CopilotModel = z.infer<typeof modelsSchema>["data"][number];

type Pending = {
  deviceCode: string;
  /** Seconds GitHub asks the poller to wait between attempts. */
  interval: number;
  expiresAt: number;
  lastAttempt: number;
};

type Credentials = {
  githubToken: string;
  login: string;
  copilotToken: string;
  copilotTokenExpiresAt: number;
  /** The account's own inference root, e.g. https://api.individual.githubcopilot.com. */
  apiBase: string;
  models: CopilotModel[];
};

/** The headers a Copilot API request takes, refreshing the short-lived inference token if needed. */
async function chatHeaders(credentials: Credentials): Promise<{headers: Record<string, string>, refreshed: Credentials}> {
  let current = credentials;
  if (current.copilotTokenExpiresAt < Date.now() + 5 * 60_000) {
    current = {...credentials, ...await exchangeCopilotToken(credentials.githubToken)};
  }
  return {headers: {
    Authorization: `Bearer ${current.copilotToken}`,
    ...INTEGRATION_HEADERS,
  }, refreshed: current};
}

/** Trades the long-lived GitHub token for a short-lived Copilot inference token's facts. */
async function exchangeCopilotToken(githubToken: string)
    : Promise<{copilotToken: string; copilotTokenExpiresAt: number; apiBase: string}> {
  const response = await fetch(`${GITHUB_API_ROOT}/copilot_internal/v2/token`, {
    headers: {Authorization: `Bearer ${githubToken}`, ...INTEGRATION_HEADERS},
    signal: AbortSignal.timeout(15000), redirect: "manual",
  });
  if (!response.ok) {
    throw new Error(`Unable to renew the Copilot token; reconnect (${response.status}).`);
  }
  const renewed = z.object({token: z.string().min(1).max(16384),
    expires_at: z.number().positive(),
    endpoints: z.object({api: z.url().max(256)})}).parse(await readJson(response));
  return {copilotToken: renewed.token, copilotTokenExpiresAt: renewed.expires_at * 1000,
    apiBase: renewed.endpoints.api.replace(/\/+$/, "")};
}

/**
 * One Copilot connection: the device-flow sign-in state, the stored credentials and their
 * short-lived inference token, and a fetch proxy that re-aims the model runtime's requests at the
 * account's inference root with fresh auth.
 */
export class CopilotConnection extends DurableObject<Cloudflare.Env> {
  #revoked = false;

  /** Starts the device flow, handing back what the user must enter on GitHub's page. */
  async begin(): Promise<{userCode: string; verificationUri: string; intervalMs: number}> {
    const response = await fetch(`${GITHUB_ROOT}/login/device/code`, {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(15000),
      headers: {"Accept": "application/json", "Content-Type": "application/json"},
      body: JSON.stringify({client_id: CLIENT_ID, scope: "read:user"}),
    });
    if (!response.ok) throw new Error(`Copilot sign-in could not start (${response.status}).`);
    const started = z.object({device_code: z.string().min(1).max(512),
      user_code: z.string().regex(/^[A-Z0-9-]{4,12}$/), verification_uri: z.url().max(256),
      interval: z.number().positive().default(5), expires_in: z.number().positive().default(900)})
        .parse(await readJson(response));
    const intervalMs = started.interval * 1000;
    await this.ctx.storage.put("pending", {
      deviceCode: started.device_code, interval: started.interval,
      expiresAt: Date.now() + started.expires_in * 1000, lastAttempt: 0,
    } satisfies Pending);
    return {userCode: started.user_code, verificationUri: started.verification_uri, intervalMs};
  }

  /**
   * Polls the sign-in once, respecting GitHub's interval. False while GitHub says pending; an
   * error once the flow expired or GitHub declined.
   */
  async complete(): Promise<boolean> {
    if (this.#revoked) throw new Error("Reconnect GitHub Copilot from AI Providers.");
    let pending = await this.ctx.storage.get<Pending>("pending");
    if (!pending) return false;
    if (Date.now() >= pending.expiresAt) {
      await this.ctx.storage.delete("pending");
      throw new Error("Copilot sign-in timed out. Start it again.");
    }
    const sinceLast = Date.now() - pending.lastAttempt;
    const wait = pending.interval * 1000;
    if (sinceLast < wait) {
      // Sleep out the remainder so consecutive browser polls make real attempts, then re-read in
      // case another poll answered first.
      await new Promise(done => setTimeout(done, wait - sinceLast));
      pending = await this.ctx.storage.get<Pending>("pending");
      if (!pending) return false;
      if (Date.now() < pending.lastAttempt + wait) return false;
    }
    await this.ctx.storage.put("pending", {...pending, lastAttempt: Date.now()});
    const response = await fetch(`${GITHUB_ROOT}/login/oauth/access_token`, {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(15000),
      headers: {"Accept": "application/json", "Content-Type": "application/json"},
      body: JSON.stringify({client_id: CLIENT_ID, device_code: pending.deviceCode,
        grant_type: DEVICE_GRANT}),
    });
    if (!response.ok) throw new Error(`Copilot sign-in failed (${response.status}).`);
    const granted = z.object({access_token: z.string().max(16384).optional(),
      error: z.string().max(64).optional(),
      error_description: z.string().max(512).optional(),
      interval: z.number().positive().optional()}).parse(await readJson(response));
    if (granted.error === "authorization_pending") return false;
    if (granted.error === "slow_down") {
      if (granted.interval) await this.ctx.storage.put("pending",
          {...pending, interval: granted.interval, lastAttempt: Date.now()});
      return false;
    }
    if (granted.error || !granted.access_token) {
      await this.ctx.storage.delete("pending");
      throw new Error(`GitHub declined the sign-in: ${granted.error_description ?? granted.error}`);
    }
    const profile = await fetch(`${GITHUB_API_ROOT}/user`, {
      headers: {Authorization: `Bearer ${granted.access_token}`,
        Accept: "application/vnd.github+json"},
      signal: AbortSignal.timeout(15000), redirect: "manual",
    });
    if (!profile.ok) throw new Error(`Unable to read the GitHub profile (${profile.status}).`);
    const identity = z.object({login: z.string().min(1).max(128)}).parse(await readJson(profile));
    const credentials: Credentials = {
      githubToken: granted.access_token, login: identity.login,
      ...(await exchangeCopilotToken(granted.access_token)), models: [],
    };
    const models = modelsSchema.parse((await (await fetch(`${credentials.apiBase}/models`, {
      headers: {Authorization: `Bearer ${credentials.copilotToken}`, ...INTEGRATION_HEADERS},
      signal: AbortSignal.timeout(30000), redirect: "manual",
    })).json())).data;
    await this.ctx.storage.put("credentials", {...credentials, models});
    await this.ctx.storage.delete("pending");
    return true;
  }

  /** The connected account's model catalog, minted at sign-in. */
  async models(): Promise<{id: string; name: string}[]> {
    const saved = await this.ctx.storage.get<Credentials>("credentials");
    if (!saved) return [];
    return saved.models.map(({id, name}) => ({id, name: name ?? id}));
  }

  async disconnect(): Promise<void> {
    this.#revoked = true;
    await this.ctx.storage.deleteAll();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/chat/completions") {
      return new Response("Not found", {status: 404});
    }
    const saved = await this.ctx.storage.get<Credentials>("credentials");
    if (!saved) throw new Error("Reconnect GitHub Copilot from AI Providers.");
    const {headers, refreshed} = await chatHeaders(saved);
    if (refreshed !== saved) await this.ctx.storage.put("credentials", refreshed);
    return fetch(`${refreshed.apiBase}/chat/completions`, {
      method: "POST", headers: {...headers, "Content-Type": "application/json"},
      body: await request.text(), redirect: "manual", signal: request.signal,
    });
  }
}
