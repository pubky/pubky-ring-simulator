import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import {
  AuthFlowKind as LegacyAuthFlowKind,
  Pubky as LegacyPubky,
  PublicKey as LegacyPublicKey,
} from "legacy-pubky";
import { Keypair, Pubky } from "@synonymdev/pubky";

const CAPABILITIES = "/pub/example.app/:rw";
const TESTNET_HOMESERVER =
  "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo";

test("the current signer approves an SDK 0.9.3 sign-in request", async () => {
  await assertLegacyApproval(LegacyAuthFlowKind.signin(), "signin");
});

test("the current signer approves an SDK 0.9.3 sign-up request", async () => {
  const homeserver = LegacyPublicKey.from(TESTNET_HOMESERVER);
  await assertLegacyApproval(
    LegacyAuthFlowKind.signup(homeserver, "test-signup-token"),
    "signup",
  );
});

async function assertLegacyApproval(kind, expectedIntent) {
  const relay = await startRelay();

  try {
    const requester = new LegacyPubky();
    const flow = requester.startAuthFlow(CAPABILITIES, kind, relay.inboxUrl);
    const authorizationUrl = flow.authorizationUrl;
    assert.equal(new URL(authorizationUrl).hostname, expectedIntent);

    const keypair = Keypair.random();
    const signer = new Pubky().signer(keypair);

    await signer.approveAuthRequest(authorizationUrl);
    const token = await withTimeout(flow.awaitToken(), 10_000);

    assert.equal(token.publicKey.toString(), keypair.publicKey.toString());
    assert.deepEqual(Array.from(token.capabilities), [CAPABILITIES]);
    assert.equal(relay.posts, 1);
    assert.equal(relay.acknowledgements, 1);
  } finally {
    await relay.close();
  }
}

async function startRelay() {
  let payload;
  let posts = 0;
  let acknowledgements = 0;
  const waitingReaders = new Set();

  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url ?? "/", "http://localhost").pathname;
      if (!path.startsWith("/inbox/") || path.endsWith("/ack")) {
        response.writeHead(404).end();
        return;
      }

      if (request.method === "POST") {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        payload = Buffer.concat(chunks);
        posts += 1;

        for (const reader of waitingReaders) sendPayload(reader, payload);
        waitingReaders.clear();
        response.writeHead(200).end();
        return;
      }

      if (request.method === "GET") {
        if (payload) {
          sendPayload(response, payload);
        } else {
          waitingReaders.add(response);
          request.on("close", () => waitingReaders.delete(response));
        }
        return;
      }

      if (request.method === "DELETE") {
        if (!payload) {
          response.writeHead(404).end();
          return;
        }

        payload = undefined;
        acknowledgements += 1;
        response.writeHead(200).end();
        return;
      }

      response.writeHead(405).end();
    } catch (error) {
      response.writeHead(500).end(String(error));
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert(address && typeof address !== "string");

  return {
    get acknowledgements() {
      return acknowledgements;
    },
    async close() {
      for (const reader of waitingReaders) reader.writeHead(408).end();
      waitingReaders.clear();
      server.closeAllConnections();
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
    inboxUrl: `http://127.0.0.1:${address.port}/inbox`,
    get posts() {
      return posts;
    },
  };
}

function sendPayload(response, payload) {
  response.writeHead(200, { "content-type": "application/octet-stream" });
  response.end(payload);
}

async function withTimeout(promise, milliseconds) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Auth flow timed out after ${milliseconds}ms`)),
      milliseconds,
    );
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
