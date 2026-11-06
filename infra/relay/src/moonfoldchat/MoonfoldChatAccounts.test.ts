import { describe, expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import * as RelayConfiguration from "../Config.ts";
import * as MoonfoldChatAccounts from "./MoonfoldChatAccounts.ts";

const clerk = vi.hoisted(() => ({
  getUser: async (): Promise<unknown> => ({ primaryEmailAddress: { emailAddress: "a@b.co" } }),
}));
vi.mock("@clerk/backend", () => ({
  createClerkClient: () => ({ users: { getUser: () => clerk.getUser() } }),
}));

const SECRET = "shared-link-secret";

const relaySettings = (
  moonfoldChat: RelayConfiguration.MoonfoldChatSettings | null,
): RelayConfiguration.RelayConfiguration["Service"] => ({
  relayIssuer: "https://relay.example.test",
  apns: null,
  clerkSecretKey: Redacted.make("clerk-secret-key"),
  clerkPublishableKey: "pk_test_test",
  clerkJwtAudience: "moonfold-relay",
  apnsDeliveryJobSigningSecret: Redacted.make("apns-delivery-secret"),
  cloudMintPrivateKey: Redacted.make("cloud-mint-private-key"),
  cloudMintPublicKey: "cloud-mint-public-key",
  managedEndpointBaseDomain: undefined,
  managedEndpointNamespace: undefined,
  ...(moonfoldChat ? { moonfoldChat } : {}),
});

const fakeMoonfoldChat = (body: unknown, status = 200) => {
  const requests: Array<{ url: string; authorization: string | undefined; body: unknown }> = [];
  const client = HttpClient.make((request) =>
    Effect.gen(function* () {
      requests.push({
        url: request.url,
        authorization: request.headers["authorization"],
        body:
          request.body._tag === "Uint8Array"
            ? JSON.parse(new TextDecoder().decode(request.body.body))
            : null,
      });
      return HttpClientResponse.fromWeb(
        request,
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
      );
    }),
  );
  return { client, requests };
};

const provide = (
  client: HttpClient.HttpClient,
  moonfoldChat: RelayConfiguration.MoonfoldChatSettings | null = {
    baseUrl: "https://chat.example.test",
    linkSecret: Redacted.make(SECRET),
  },
) =>
  Effect.provide(
    MoonfoldChatAccounts.layer.pipe(
      Layer.provide(RelayConfiguration.layer(relaySettings(moonfoldChat))),
      Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
    ),
  );

describe("MoonfoldChatAccounts", () => {
  it.effect("signs link tokens in the format Moonfold Chat verifies", () =>
    Effect.gen(function* () {
      const accounts = yield* MoonfoldChatAccounts.MoonfoldChatAccounts;
      const url = new URL(yield* accounts.createLinkUrl({ userId: "user_1" }));
      expect(`${url.origin}${url.pathname}`).toBe("https://chat.example.test/link/moonfold");

      const [payload = "", signature = ""] = (url.searchParams.get("token") ?? "").split(".");
      // Verify with Web Crypto, as Moonfold Chat does, rather than the signing library.
      const verified = yield* Effect.promise(async () => {
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
          "raw",
          encoder.encode(SECRET),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["verify"],
        );
        return crypto.subtle.verify(
          "HMAC",
          key,
          Buffer.from(signature, "base64url"),
          encoder.encode(payload),
        );
      });
      expect(verified).toBe(true);
      expect(JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))).toEqual({
        v: 1,
        sub: "user_1",
        email: "a@b.co",
        exp: 600,
      });
    }).pipe(provide(fakeMoonfoldChat({}).client)),
  );

  it.effect("asks Moonfold Chat for the link with the shared secret", () => {
    const moonfoldChat = fakeMoonfoldChat({ link: { email: "theo@t3.chat", plan: "premier", linkedAt: 1 } });
    return Effect.gen(function* () {
      const accounts = yield* MoonfoldChatAccounts.MoonfoldChatAccounts;
      const link = yield* accounts.getLink({ userId: "user_1" });
      expect(link).toEqual({ email: "theo@t3.chat", plan: "premier" });
      expect(moonfoldChat.requests).toEqual([
        {
          url: "https://chat.example.test/api/moonfold/link",
          authorization: `Bearer ${SECRET}`,
          body: { clerkUserId: "user_1" },
        },
      ]);
    }).pipe(provide(moonfoldChat.client));
  });

  it.effect("fails instead of guessing when Moonfold Chat errors", () =>
    Effect.gen(function* () {
      const accounts = yield* MoonfoldChatAccounts.MoonfoldChatAccounts;
      const error = yield* Effect.flip(accounts.getLink({ userId: "user_1" }));
      expect(error._tag).toBe("MoonfoldChatRequestFailed");
    }).pipe(provide(fakeMoonfoldChat({ error: "nope" }, 401).client)),
  );

  it.effect("times out when Moonfold Chat stalls while sending the body", () => {
    const client = HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(new ReadableStream({ start: () => {} }), { status: 200 }),
        ),
      ),
    );
    return Effect.gen(function* () {
      const accounts = yield* MoonfoldChatAccounts.MoonfoldChatAccounts;
      const fiber = yield* Effect.forkChild(Effect.flip(accounts.getLink({ userId: "user_1" })));
      yield* TestClock.adjust("5 seconds");
      const error = yield* Fiber.join(fiber);
      expect(error._tag).toBe("MoonfoldChatRequestFailed");
    }).pipe(provide(client));
  });

  it.effect("times out when Clerk stalls on the email lookup", () =>
    Effect.gen(function* () {
      const getUser = clerk.getUser;
      clerk.getUser = () => new Promise(() => {});
      const accounts = yield* MoonfoldChatAccounts.MoonfoldChatAccounts;
      const fiber = yield* Effect.forkChild(Effect.flip(accounts.createLinkUrl({ userId: "u" })));
      yield* TestClock.adjust("5 seconds");
      const error = yield* Fiber.join(fiber).pipe(
        Effect.ensuring(Effect.sync(() => (clerk.getUser = getUser))),
      );
      expect(error._tag).toBe("ClerkUserLookupFailed");
    }).pipe(provide(fakeMoonfoldChat({}).client)),
  );

  it.effect("reports itself unavailable without a shared secret", () =>
    Effect.gen(function* () {
      const accounts = yield* MoonfoldChatAccounts.MoonfoldChatAccounts;
      expect(accounts.available).toBe(false);
      const error = yield* Effect.flip(accounts.getLink({ userId: "user_1" }));
      expect(error._tag).toBe("MoonfoldChatNotConfigured");
    }).pipe(provide(fakeMoonfoldChat({}).client, null)),
  );
});
