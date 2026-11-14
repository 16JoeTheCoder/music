import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import worker from "../server/index";

const issuer = "https://review-issuer.example";
const audience = "private-music";
const email = "owner@example.com";
let privateKey: CryptoKey;
let otherKey: CryptoKey;
const db = { prepare: () => ({ all: async () => ({ results: [] }) }) };
const env = {
  DB: db,
  ACCESS_ISSUER: issuer,
  ACCESS_AUDIENCE: audience,
  ALLOWED_EMAIL: email,
} as unknown as import("../server/index").Env;
const ctx = {
  waitUntil: (p: Promise<unknown>) => {
    void p.catch(() => {});
  },
} as ExecutionContext;
async function signed(claims: Record<string, unknown>, key = privateKey) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "review-key" })
    .sign(key);
}
const valid = () => ({
  iss: issuer,
  aud: audience,
  email,
  exp: Math.floor(Date.now() / 1000) + 300,
});
async function request(path: string, token?: string) {
  return worker.fetch(
    new Request(`https://music.example${path}`, {
      headers: token ? { "Cf-Access-Jwt-Assertion": token } : {},
    }),
    env,
    ctx,
  );
}

describe("Access JWT enforcement", () => {
  beforeAll(async () => {
    const pair = await generateKeyPair("RS256", { extractable: true });
    privateKey = pair.privateKey;
    otherKey = (await generateKeyPair("RS256")).privateKey;
    const jwk = await exportJWK(pair.publicKey);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              keys: [{ ...jwk, kid: "review-key", alg: "RS256", use: "sig" }],
            }),
            {
              headers: {
                "Content-Type": "application/json",
                "Cache-Control": "max-age=300",
              },
            },
          ),
      ),
    );
  });
  afterAll(() => vi.unstubAllGlobals());
  it("accepts a correctly signed, unexpired token for the configured identity", async () => {
    expect((await request("/api/tracks", await signed(valid()))).status).toBe(
      200,
    );
  });
  it("rejects missing, expired, and invalid identity claims and signature", async () => {
    const v = valid();
    const { exp: _exp, ...withoutExpiry } = v;
    const tokens = [
      undefined,
      await signed(withoutExpiry),
      await signed({ ...v, exp: 1 }),
      await signed({ ...v, iss: "https://wrong.example" }),
      await signed({ ...v, aud: "wrong" }),
      await signed({ ...v, email: "other@example.com" }),
      await signed(v, otherKey),
    ];
    for (const token of tokens)
      expect((await request("/api/tracks", token)).status).toBe(401);
  });
  it("requires authentication for each private read path, including media", async () => {
    for (const path of [
      "/api/tracks",
      "/api/tracks/track-1/audio",
      "/api/tracks/track-1/art",
      "/api/playlists",
      "/api/history",
    ])
      expect((await request(path)).status).toBe(401);
  });
});
