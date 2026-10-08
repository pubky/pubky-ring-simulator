import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";

import {
  approveAuthRequest,
  assertLocalAuthRequest,
  createIdentity,
  parseAuthRequest,
} from "../.test-dist/src/pubky.js";

// CI supplies an isolated historical SDK package; local runs use the installed SDK.
const require = createRequire(import.meta.url);
const requesterModule = process.env.PUBKY_REQUESTER_MODULE ?? "@synonymdev/pubky";
const requesterSdk = require(requesterModule);
const { version } = JSON.parse(
  await readFile(join(dirname(require.resolve(requesterModule)), "package.json"), "utf8"),
);
if (process.env.PUBKY_REQUESTER_VERSION) {
  assert.equal(version, process.env.PUBKY_REQUESTER_VERSION);
}

const CAPABILITIES = "/pub/example.app/:rw";
const TESTNET_HOMESERVER =
  "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo";

for (const intent of ["signin", "signup"]) {
  test(`the simulator approves an SDK ${version} cookie ${intent} request`, async () => {
    const relay = await startRelay(version === "0.6.0" ? "link" : "inbox");

    try {
      const requester = requesterSdk.Pubky.testnet();
      const startFlow = requester.startCookieAuthFlow ?? requester.startAuthFlow;
      const flow = startFlow.call(requester, CAPABILITIES, authKind(intent), relay.url);
      const request = parseAuthRequest(flow.authorizationUrl);
      assertPreview(request, intent, "cookie", relay.url);

      const identity = createIdentity();
      const approved = await withTimeout(
        approveAuthRequest(identity, flow.authorizationUrl),
        10_000,
      );
      assert.deepEqual(approved, request);
      const token = await withTimeout(flow.awaitToken(), 10_000);

      assert.equal(token.publicKey.toString(), identity.publicKey);
      assert.deepEqual(Array.from(token.capabilities), [CAPABILITIES]);
      assert.equal(relay.posts, 1);
    } finally {
      await relay.close();
    }
  });

  if (requesterSdk.GrantAuthFlow) {
    test(`the simulator previews an SDK ${version} grant ${intent} request`, () => {
      const relay = "http://127.0.0.1:15403/inbox";
      // The standalone flow creates a real requester link without requiring
      // browser IndexedDB or a live Homeserver. Live approval is a separate check.
      const flow = requesterSdk.GrantAuthFlow.start(
        CAPABILITIES,
        authKind(intent),
        { clientId: "example.app", relay },
      );
      try {
        const request = parseAuthRequest(flow.authorizationUrl);
        assertPreview(request, intent, "grant", relay);
        assert.equal(request.clientId, "example.app");
      } finally {
        flow.free();
      }
    });
  }
}

function authKind(intent) {
  return intent === "signin"
    ? requesterSdk.AuthFlowKind.signin()
    : requesterSdk.AuthFlowKind.signup(
        requesterSdk.PublicKey.from(TESTNET_HOMESERVER),
        "test-signup-token",
      );
}

function assertPreview(request, intent, authMode, relay) {
  assert.equal(request.kind, intent);
  assert.equal(request.authMode, authMode);
  assert.deepEqual(request.capabilities, [CAPABILITIES]);
  assert.equal(request.relay, relay);
  if (intent === "signup") {
    assert.equal(request.homeserver, `pubky${TESTNET_HOMESERVER}`);
  }
  assert.equal(assertLocalAuthRequest(request), request);
}

async function startRelay(path) {
  let payload;
  let posts = 0;
  const waitingReaders = new Set();

  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      if (!pathname.startsWith(`/${path}/`) || pathname.endsWith("/ack")) {
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

      if (request.method === "DELETE" && path === "inbox") {
        if (!payload) {
          response.writeHead(404).end();
          return;
        }
        payload = undefined;
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
    async close() {
      for (const reader of waitingReaders) reader.writeHead(408).end();
      waitingReaders.clear();
      server.closeAllConnections();
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
    url: `http://127.0.0.1:${address.port}/${path}`,
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
