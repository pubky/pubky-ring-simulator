import { strict as assert } from "node:assert";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import {
  AuthFlowKind,
  Pubky,
  PublicKey,
  type GrantAuthFlow,
} from "@synonymdev/pubky";
import {
  approveAuthRequest,
  assertLocalAuthRequest,
  assertSupportedAuthRequest,
  callbackUrlFor,
  createIdentity,
  parseAuthRequest,
  pubky,
} from "../src/pubky.js";

const LOCAL_HOMESERVER =
  "pubky8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo";
const OTHER_HOMESERVER =
  "pubky5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo";
const RELAY = "http://localhost:15412/inbox";
const SECRET = "kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8";
const GRANT_CALLBACKS = {
  xSource: "Example App",
  xSuccess: "example://auth/success?state=one%20two&next=%2Fhome",
  xError: "example://auth/error?state=one%20two",
  xCancel: "example://auth/cancel?state=one%20two",
};

function authUrl(intent: string, params: Record<string, string>) {
  const query = Object.entries(params)
    .map(
      ([name, value]) =>
        `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    )
    .join("&");
  return `pubkyauth://${intent}?${query}`;
}

test("parses a legacy cookie sign-in request and callbacks", () => {
  const success = "example://auth/success?state=ready";
  const request = parseAuthRequest(authUrl("signin", {
    caps: "/pub/example.app/:rw",
    relay: RELAY,
    secret: SECRET,
    "x-source": "Example App",
    "x-success": success,
  }));

  assert.equal(request.authMode, "cookie");
  assert.equal(request.kind, "signin");
  assert.deepEqual(request.capabilities, ["/pub/example.app/:rw"]);
  assert.equal(request.xCallback?.xSource, "Example App");
  assert.equal(callbackUrlFor(request, "success"), success);
});

for (const kind of ["signin", "signup"] as const) {
  test(`parses an SDK-generated grant ${kind} request`, async () => {
    const flowKind = kind === "signin"
      ? AuthFlowKind.signin()
      : AuthFlowKind.signup(
          PublicKey.from(LOCAL_HOMESERVER),
          "test-signup-token",
        );

    await withGrantAuthFlow(flowKind, (authorizationUrl, relay) => {
      const request = parseAuthRequest(` \n${authorizationUrl}\n `);

      assert.equal(request.authMode, "grant");
      assert.equal(request.kind, kind);
      assert.equal(request.clientId, "example.app");
      assert.deepEqual(request.capabilities, [
        "/pub/example.app/:rw",
        "/priv/example.app/settings:r",
      ]);
      assert.equal(request.relay, relay);
      assert.equal(request.url, authorizationUrl);
      assert.deepEqual(request.xCallback, GRANT_CALLBACKS);
      assert.equal(callbackUrlFor(request, "success"), GRANT_CALLBACKS.xSuccess);
      assert.equal(callbackUrlFor(request, "error"), GRANT_CALLBACKS.xError);
      assert.equal(callbackUrlFor(request, "cancel"), GRANT_CALLBACKS.xCancel);
      assert.equal(assertLocalAuthRequest(request), request);

      if (kind === "signup") {
        assert.equal(request.homeserver, LOCAL_HOMESERVER);
        assert.throws(
          () => assertSupportedAuthRequest(request),
          /Use a sign-in request/,
        );
      } else {
        assert.equal(assertSupportedAuthRequest(request), request);
      }
    });
  });
}

test("does not expose executable callback destinations", () => {
  const request = parseAuthRequest(authUrl("signin", {
    caps: "",
    relay: RELAY,
    secret: SECRET,
    "x-success": "javascript:alert(document.domain)",
  }));

  assert.equal(request.xCallback?.xSuccess, "javascript:alert(document.domain)");
  assert.equal(callbackUrlFor(request, "success"), undefined);
});

test("rejects signup for a non-local Homeserver", () => {
  const request = parseAuthRequest(authUrl("signup", {
    caps: "",
    relay: RELAY,
    secret: SECRET,
    hs: OTHER_HOMESERVER.slice(5),
  }));

  assert.throws(
    () => assertLocalAuthRequest(request),
    /targets a different Homeserver/,
  );
});

test("rejects SDK-generated non-local grant signup before using the signer", async (t) => {
  const signer = t.mock.method(pubky, "signer", () => {
    throw new Error("A rejected signup must not reach the signer.");
  });
  const identity = createIdentity();

  try {
    await withGrantAuthFlow(
      AuthFlowKind.signup(PublicKey.from(OTHER_HOMESERVER), null),
      async (authorizationUrl) => {
        await assert.rejects(
          approveAuthRequest(identity, authorizationUrl),
          /targets a different Homeserver/,
        );
        assert.equal(signer.mock.callCount(), 0);
      },
    );
  } finally {
    identity.keypair.free();
  }
});

test("rejects direct signup with a specific explanation", () => {
  assert.throws(
    () =>
      parseAuthRequest(authUrl("direct_signup", {
        hs: LOCAL_HOMESERVER.slice(5),
      })),
    /Direct signup requests are not supported/,
  );
});

test("keeps shortcut auth restricted to sign-in requests", () => {
  const request = parseAuthRequest(authUrl("signup", {
    caps: "",
    relay: RELAY,
    secret: SECRET,
    hs: LOCAL_HOMESERVER.slice(5),
  }));

  assert.throws(() => assertSupportedAuthRequest(request), /Use a sign-in request/);
});

test("rejects noncanonical capabilities inserted into an SDK-generated grant request", async () => {
  await withGrantAuthFlow(AuthFlowKind.signin(), (authorizationUrl) => {
    for (const capability of [
      "relative:r",
      "/pub/example.app//settings:r",
      "/pub/example.app/./settings:r",
      "/pub/example.app/../settings:r",
    ]) {
      const altered = new URL(authorizationUrl);
      altered.searchParams.set("caps", `/pub/example.app/:rw,${capability}`);

      assert.throws(
        () => parseAuthRequest(altered.toString()),
        /invalid capability/i,
        capability,
      );
    }
  });
});

async function withGrantAuthFlow(
  kind: AuthFlowKind,
  verify: (authorizationUrl: string, relay: string) => void | Promise<void>,
) {
  const server = createServer((request, response) => {
    // Hold the SDK's background long poll until the flow is freed below.
    if (request.method !== "GET") response.writeHead(405).end();
  });
  const listening = once(server, "listening");
  server.listen(0, "127.0.0.1");
  await listening;

  const requester = Pubky.testnet();
  let flow: GrantAuthFlow | undefined;

  try {
    const address = server.address();
    assert(address && typeof address !== "string");
    const relay = `http://127.0.0.1:${address.port}/inbox`;
    flow = await requester.startGrantAuthFlow(
      "/pub/example.app/:wr,/priv/example.app/settings:r",
      kind,
      { clientId: "example.app", relay, xCallback: GRANT_CALLBACKS },
    );

    await verify(flow.authorizationUrl, relay);
  } finally {
    flow?.free();
    requester.free();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}
