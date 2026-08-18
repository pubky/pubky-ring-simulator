import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  assertLocalAuthRequest,
  assertSupportedAuthRequest,
  callbackUrlFor,
  parseAuthRequest,
} from "../src/pubky.js";

const LOCAL_HOMESERVER =
  "pubky8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo";
const OTHER_HOMESERVER =
  "pubky5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo";
const RELAY = "http://localhost:15412/inbox";
const SECRET = "kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8";
const CLIENT_PUBLIC_KEY =
  "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo";

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

test("parses grant sign-in metadata and all callback outcomes", () => {
  const callbacks = {
    cancel: "example://auth/cancel",
    error: "example://auth/error",
    success: "example://auth/success",
  };
  const request = parseAuthRequest(authUrl("signin_grant", {
    caps: "/pub/example.app/:rw,/priv/example.app/settings:r",
    relay: RELAY,
    secret: SECRET,
    cid: "example.app",
    cpk: CLIENT_PUBLIC_KEY,
    "x-success": callbacks.success,
    "x-error": callbacks.error,
    "x-cancel": callbacks.cancel,
  }));

  assert.equal(request.authMode, "grant");
  assert.equal(request.kind, "signin");
  assert.equal(request.clientId, "example.app");
  assert.deepEqual(request.capabilities, [
    "/pub/example.app/:rw",
    "/priv/example.app/settings:r",
  ]);
  assert.equal(callbackUrlFor(request, "success"), callbacks.success);
  assert.equal(callbackUrlFor(request, "error"), callbacks.error);
  assert.equal(callbackUrlFor(request, "cancel"), callbacks.cancel);
});

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

test("accepts grant signup for the default local Homeserver", () => {
  const request = parseAuthRequest(authUrl("signup_grant", {
    caps: "/pub/example.app/:rw",
    relay: RELAY,
    secret: SECRET,
    hs: LOCAL_HOMESERVER.slice(5),
    cid: "example.app",
    cpk: CLIENT_PUBLIC_KEY,
  }));

  assert.equal(request.authMode, "grant");
  assert.equal(request.kind, "signup");
  assert.equal(request.homeserver, LOCAL_HOMESERVER);
  assert.equal(assertLocalAuthRequest(request), request);
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

test("uses strict capability parsing from the SDK", () => {
  assert.throws(
    () =>
      parseAuthRequest(authUrl("signin_grant", {
        caps: "/pub/example.app/:rw,relative:r",
        relay: RELAY,
        secret: SECRET,
        cid: "example.app",
        cpk: CLIENT_PUBLIC_KEY,
      })),
    /invalid capability/i,
  );
});
