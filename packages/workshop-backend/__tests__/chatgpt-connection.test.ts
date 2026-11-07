import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { ChatGptConnection, chatGptPayload } from "../src/chatgpt-connection.js";
import { getModel } from "../src/ai-models.js";
import type { UserDurableObject } from "../src/user.js";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    TEST_CHATGPT: DurableObjectNamespace<ChatGptConnection>;
    TEST_USER: DurableObjectNamespace<UserDurableObject>;
  }
}

afterEach(() => vi.unstubAllGlobals());

describe("ChatGPT plan connection", () => {
  it("uses stateless streaming, developer instructions and namespaced tools", () => {
    const payload = chatGptPayload({model: "model", store: true, stream: false,
      input: [{type: "message", role: "system", content: "instructions"}],
      tools: [{type: "function", name: "read"}], max_output_tokens: 1000,
      temperature: 0.5, previous_response_id: "old"});
    expect(payload).toEqual({model: "model", store: false, stream: true,
      input: [{type: "message", role: "developer", content: "instructions"}],
      tools: [{type: "namespace", name: "workshop", tools: [{type: "function", name: "read"}]}]});
    expect(() => chatGptPayload({tools: [{type: "tool_search"}]})).toThrow("not supported");
  });

  it("validates identity and scope, isolates credentials and clears them on disconnect", async () => {
    const {publicKey, privateKey} = await generateKeyPair("RS256", {extractable: true});
    const jwk = {...await exportJWK(publicKey), kid: "chatgpt-test", alg: "RS256", use: "sig"};
    const sign = (audience: string, claims: Record<string, unknown>) => new SignJWT(claims)
      .setProtectedHeader({alg: "RS256", kid: "chatgpt-test"})
      .setIssuer("https://auth.openai.com").setAudience(audience).setSubject("account-one")
      .setIssuedAt().setExpirationTime("1h").sign(privateKey);
    const access = await sign("https://api.openai.com/v1", {
      client_id: "oaiapp_test", scope: "chatgpt.tokens.use.direct"});
    const identity = await sign("oaiapp_test", {email: "user@example.com"});
    const renewedAccess = await sign("https://api.openai.com/v1", {
      client_id: "oaiapp_test", scope: "chatgpt.tokens.use.direct", jti: "renewed"});
    const calls: Request[] = [];
    let revokedToken: FormDataEntryValue | null = null;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      calls.push(request);
      if (request.url.endsWith("jwks.json")) return Response.json({keys: [jwk]});
      if (request.url.endsWith("openid-configuration")) return Response.json({
        revocation_endpoint: "https://auth.openai.com/revoke"});
      if (request.url.endsWith("/revoke")) {
        revokedToken = (await request.formData()).get("token");
        return new Response(null, {status: 200});
      }
      if (request.url.endsWith("/oauth/token")) {
        await new Promise(done => setTimeout(done, 10));
        return Response.json({access_token: renewedAccess, refresh_token: "rotated-secret",
          scope: "chatgpt.tokens.use.direct", expires_in: 3600});
      }
      if (request.url.endsWith("/models")) return Response.json({models: [
        {slug: "model-one", display_name: "Model One", visibility: "list"},
        {slug: "hidden", display_name: "Hidden", visibility: "hidden"},
      ]});
      if (request.url.endsWith("/responses")) return Response.json({error: {message: "test inference"}}, {status: 400});
      throw new Error("Unexpected outbound request");
    }));
    const stub = env.TEST_CHATGPT.getByName(crypto.randomUUID());
    const another = env.TEST_CHATGPT.getByName(crypto.randomUUID());
    const credentials = {client_id: "oaiapp_test", ext_agent_host_id: "host",
      access_token: access, refresh_token: "refresh-secret", id_token: identity};
    const catalog = await runInDurableObject(stub, instance => instance.initialize(JSON.stringify(credentials)));
    expect(catalog).toEqual({email: "user@example.com", models: [{id: "model-one", name: "Model One"}]});
    const request = () => new Request("https://chatgpt.internal/v1/responses", {
      method: "POST", body: JSON.stringify({model: "model-one", input: []})});
    await runInDurableObject(stub, instance => instance.fetch(request()));
    const outbound = calls.find(request => request.url.endsWith("/responses"))!;
    expect(outbound.headers.get("authorization")).toBe(`Bearer ${access}`);
    await expect(runInDurableObject(another, instance => instance.fetch(request())))
      .rejects.toThrow("Reconnect");
    const invalid = {...credentials, access_token: await sign("https://api.openai.com/v1",
      {client_id: "oaiapp_test", scope: "openid"})};
    await expect(runInDurableObject(stub, instance => instance.initialize(JSON.stringify(invalid))))
      .rejects.toThrow("not authorized");
    await runInDurableObject(stub, async (instance, state) => {
      const saved = await state.storage.get<Record<string, unknown>>("credentials");
      await state.storage.put("credentials", {...saved, expiresAt: 0});
      await Promise.all([instance.fetch(request()), instance.fetch(request())]);
      const rotated = await state.storage.get<{refresh_token: string}>("credentials");
      expect(rotated?.refresh_token).toBe("rotated-secret");
    });
    expect(calls.filter(request => request.url.endsWith("/oauth/token"))).toHaveLength(1);
    expect(await runInDurableObject(stub, instance => instance.disconnect())).toBe(true);
    expect(revokedToken).toBe("rotated-secret");
    await expect(runInDurableObject(stub, instance => instance.fetch(request())))
      .rejects.toThrow("Reconnect");

    const user = env.TEST_USER.getByName(crypto.randomUUID());
    const otherUser = env.TEST_USER.getByName(crypto.randomUUID());
    await runInDurableObject(user, instance => instance.importChatGpt(JSON.stringify(credentials)));
    const profiles = await user.listModels();
    expect(profiles.map(profile => profile.id)).toEqual(["chatgpt:model-one"]);
    expect(profiles[0].name).not.toContain("user@example.com");
    expect(await user.getChatGptAccount()).toEqual({email: "user@example.com"});
    expect(await otherUser.getChatGptAccount()).toBeNull();
    expect(await otherUser.listModels()).toEqual([]);
    const redacted = await user.getModelConfig("chatgpt:model-one");
    expect(redacted.config.apiToken).toBeNull();
    expect(JSON.stringify(redacted)).not.toContain(access);
    const context = await user.getChatContext("chatgpt:model-one");
    const handle = getModel({} as Cloudflare.Env, context.aiModel!.config,
      {type: "user", id: "owner", name: "Owner"});
    const result = await handle.stream(handle.model,
      {messages: [{role: "user", content: "hello", timestamp: 0}]}, {maxRetries: 0}).result();
    expect(result.stopReason).toBe("error");
    expect(calls.filter(request => request.url.endsWith("/responses"))).toHaveLength(4);
    await user.deleteModel("chatgpt:model-one");
    expect(await user.listModels()).toEqual([]);
    expect(await user.getChatGptAccount()).toBeNull();
    expect(await user.disconnectChatGpt()).toBe(true);
  });
});
