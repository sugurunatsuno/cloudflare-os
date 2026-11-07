import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { parseOpenCodeGoModels, OPENCODE_GO_MODELS_URL, OPENCODE_GO_METADATA_URL,
  OPENCODE_GO_REFRESH_MS } from "../src/opencode-go.js";
import type { UserDurableObject } from "../src/user.js";
import { getModel } from "../src/ai-models.js";

declare module "cloudflare:workers" {
  interface ProvidedEnv { TEST_USER: DurableObjectNamespace<UserDurableObject> }
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const catalog = (ids: string[]) => ({data: ids.map(id => ({id}))});
const metadata = {"opencode-go": {npm: "@ai-sdk/openai-compatible", models: {
  alpha: {id: "alpha", name: "Alpha", limit: {context: 100000, output: 10000}},
  beta: {id: "beta", name: "Beta", provider: {npm: "@ai-sdk/anthropic"},
    limit: {context: 200000, output: 20000}},
  gamma: {id: "gamma", name: "Gamma", provider: {npm: "@ai-sdk/openai"},
    limit: {context: 300000, output: 30000}},
}}};

const user = () => {
  const stub = env.TEST_USER.getByName(crypto.randomUUID());
  const inside = <T>(fn: (instance: UserDurableObject) => Promise<T>) => runInDurableObject(stub, fn);
  return {stub, inside};
};

describe("Go live catalog", () => {
  it("uses official availability, deduplicates IDs and discovers new protocols without a release", () => {
    const models = parseOpenCodeGoModels(catalog(["alpha", "beta", "alpha"]), metadata);
    expect(models.map(({id, api}) => ({id, api}))).toEqual([
      {id: "alpha", api: "openai-completions"}, {id: "beta", api: "anthropic-messages"},
    ]);
    expect(models[1]).toMatchObject({contextWindow: 200000, outputLimit: 20000, name: "Beta"});
    expect(models.some(model => model.id === "gamma")).toBe(false);
    expect(() => parseOpenCodeGoModels({data: []}, metadata)).toThrow();
    expect(() => parseOpenCodeGoModels({data: [{id: 12}]}, metadata)).toThrow();
    expect(parseOpenCodeGoModels(catalog(["constructor"]), null)[0].api).toBe("openai-completions");
    expect(parseOpenCodeGoModels(catalog(["beta"]), null, models)[0]).toEqual(models[1]);
  });

  it("adds new models automatically, caches reads, preserves old chats and clears all managed keys", async () => {
    let ids = ["alpha", "beta"];
    let unavailable = false;
    const requests: {url: string; authorization: string | null}[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const request = new Request(url, init);
      requests.push({url: request.url, authorization: request.headers.get("authorization")});
      if (request.url === OPENCODE_GO_MODELS_URL) return unavailable
        ? new Response(null, {status: 503}) : Response.json(catalog(ids));
      if (request.url === OPENCODE_GO_METADATA_URL) return Response.json(metadata);
      throw new Error("Unexpected URL");
    }));
    const owner = user(), another = user();
    await owner.inside(instance => instance.connectOpenCodeGo("private-go-key"));
    expect((await owner.stub.listModels()).map(model => model.id)).toEqual(["opencode-go:alpha", "opencode-go:beta"]);
    expect(await another.stub.listModels()).toEqual([]);
    const status = await owner.stub.getOpenCodeGoAccount();
    expect(status).toMatchObject({modelCount: 2, stale: false});
    expect(JSON.stringify(status)).not.toContain("private-go-key");
    expect((await owner.stub.getModelConfig("opencode-go:beta")).config.apiToken).toBeNull();
    const context = await owner.stub.getChatContext("opencode-go:beta");
    const handle = getModel({} as Cloudflare.Env, context.aiModel!.config, {type: "user", id: "owner", name: "Owner"});
    expect(handle.model.api).toBe("anthropic-messages");
    expect(handle.model.baseUrl).toBe("https://opencode.ai/inference/go/anthropic");
    expect(requests).toHaveLength(2);
    expect(requests.every(request => request.authorization === null)).toBe(true);

    ids = ["alpha", "gamma"];
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + OPENCODE_GO_REFRESH_MS + 1000);
    await owner.inside(async instance => {
      await Promise.all([instance.listModels(), instance.getOpenCodeGoAccount()]);
    });
    expect((await owner.stub.listModels()).map(model => model.id)).toEqual(["opencode-go:alpha", "opencode-go:gamma"]);
    expect((await owner.stub.getChatContext("opencode-go:beta")).aiModel?.config.model).toBe("beta");
    expect((await owner.stub.getChatContext("opencode-go:gamma")).aiModel?.config.openCodeGoApi).toBe("openai-responses");
    expect(requests).toHaveLength(4);
    await owner.stub.connectOpenCodeGo("replacement-go-key");
    expect((await owner.stub.getChatContext("opencode-go:beta")).aiModel?.config.apiToken).toBe("replacement-go-key");

    unavailable = true;
    vi.spyOn(Date, "now").mockReturnValue(now + 2 * OPENCODE_GO_REFRESH_MS + 2000);
    expect((await owner.stub.listModels()).map(model => model.id)).toEqual(["opencode-go:alpha", "opencode-go:gamma"]);
    expect((await owner.stub.getOpenCodeGoAccount())?.stale).toBe(true);
    await expect(owner.inside(instance => instance.refreshOpenCodeGoModels())).rejects.toThrow("前回の一覧は保持");
    expect((await owner.stub.getChatContext("opencode-go:alpha")).aiModel?.config.apiToken).toBe("replacement-go-key");
    await expect(owner.inside(instance => instance.deleteModel("opencode-go:alpha"))).rejects.toThrow("自動管理モデル");
    await owner.stub.disconnectOpenCodeGo();
    expect(await owner.stub.listModels()).toEqual([]);
    expect(await owner.stub.getOpenCodeGoAccount()).toBeNull();
    await expect(owner.inside(instance => instance.getChatContext("opencode-go:beta"))).rejects.toThrow("No such model");
  });

  it("migrates a saved ordinary key without changing model identity, but preserves custom configurations", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(
      url === OPENCODE_GO_MODELS_URL ? catalog(["alpha", "beta"]) : metadata)));
    const owner = user();
    await owner.stub.addModel({type: "agent", id: "legacy-alpha", name: "Old Alpha"},
      {provider: "opencode-go", model: "alpha", apiToken: "old-key"});
    await owner.stub.setPreferredModel("legacy-alpha");
    expect((await owner.stub.listModels()).map(model => model.id)).toEqual(["legacy-alpha", "opencode-go:beta"]);
    expect(await owner.stub.getPreferredModel()).toBe("legacy-alpha");
    expect((await owner.stub.getChatContext("legacy-alpha")).aiModel?.config.apiToken).toBe("old-key");
    await owner.stub.addModel({type: "agent", id: "manual-extra", name: "Separate key"},
      {provider: "opencode-go", model: "private-model", apiToken: "manual-key"});
    await owner.stub.disconnectOpenCodeGo();
    expect(await owner.stub.getOpenCodeGoAccount()).toBeNull();
    expect((await owner.stub.listModels()).map(model => model.id)).toEqual(["manual-extra"]);

    const custom = user();
    await custom.stub.addModel({type: "agent", id: "opencode-go:alpha", name: "Custom"},
      {provider: "opencode-go", model: "alpha", apiToken: "proxy-key", apiUrl: "https://proxy.example/v1"});
    expect(await custom.stub.getOpenCodeGoAccount()).toBeNull();
    await custom.stub.connectOpenCodeGo("separate-key");
    expect((await custom.stub.getChatContext("opencode-go:alpha")).aiModel?.config.apiUrl).toBe("https://proxy.example/v1");
    await custom.stub.disconnectOpenCodeGo();
    expect((await custom.stub.listModels()).map(model => model.id)).toEqual(["opencode-go:alpha"]);
  });

  it("does not restore a connection disconnected while a refresh is in flight", async () => {
    const owner = user();
    let hold = false;
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === OPENCODE_GO_MODELS_URL) {
        if (hold) { entered(); await gate; }
        return Response.json(catalog(["alpha"]));
      }
      return Response.json(metadata);
    }));
    await owner.stub.connectOpenCodeGo("go-key");
    hold = true;
    await owner.inside(async instance => {
      const refresh = instance.refreshOpenCodeGoModels();
      await started;
      await instance.disconnectOpenCodeGo();
      release();
      await refresh;
      expect(await instance.getOpenCodeGoAccount()).toBeNull();
      expect(await instance.listModels()).toEqual([]);
    });
  });
});
