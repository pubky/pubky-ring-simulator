# Pubky Ring Simulator

> [!WARNING]
> This is experimental developer tooling, built quickly for local testing rather than engineered to
> production standards. It is not Pubky Ring and should not be relied on for real identities or any
> use beyond development and testing.

**Live simulator:** [simulator.pubkyring.app](https://simulator.pubkyring.app/)

Pubky Ring Simulator is an opinionated browser tool for testing Pubky authentication with multiple
disposable identities. Its interface is inspired by
[Pubky Ring](https://github.com/pubky/pubky-ring), while its workflows are optimized for local app
development.

## Ephemeral by design

Identities exist in memory only. The simulator does not provide recovery phrases, import, export,
backup, or persistent browser storage. Reloading or closing the page permanently discards every
generated key.

Creating an identity still registers its public key with the local testnet Homeserver. The private
key never leaves the current page and cannot be recovered after it disappears.

## Local testnet only

There is no mainnet mode and there are no network, Homeserver, admin-password, or registration-code
controls in the UI.

The app only works when the default testnet environment is running on the same machine. Start
[pubky/pubky-docker](https://github.com/pubky/pubky-docker) before opening the simulator:

```bash
git clone https://github.com/pubky/pubky-docker.git
cd pubky-docker
cp .env-sample .env
docker compose --profile backend pull homeserver
docker compose --profile backend up -d
```

The simulator assumes Pubky Docker's default Homeserver identity, local ports, admin endpoint, and
admin password. Grant requests require a Homeserver build with grant authentication support.
Requests containing the `e` action also need support for scoped encryption keys. Pull the Homeserver
image before starting an existing stack: a cached image tagged `latest` may predate these features.
Check the running image and the Homeserver version reported by its admin `/info` endpoint when
diagnosing compatibility; starting the containers alone does not establish support. See the
[SDK deployment guidance](https://github.com/pubky/pubky-homeserver/blob/v0.17.1/docs/scoped-encryption-keys.md#compatibility-and-deployment).

## Quick auth

Paste or screen-scan a `pubkyauth://` cookie or grant sign-in request and use the primary action:

- If the active identity is already registered, it is used immediately.
- If another registered identity exists, it becomes active and is used.
- If no registered identity exists, the simulator creates one, registers it on the default local
  Homeserver, and approves the sign-in request in one flow.

Registration details remain hidden, including obtaining any server-required registration
credential from the default local admin endpoint.

Regular mode previews whether a request uses grant or legacy cookie authentication, identifies the
requesting application when provided, and shows whether each capability targets an exact path or a
directory. Signup requests must target the default local Homeserver. Direct-signup links are not
supported because the simulator creates and registers test identities itself.

In regular mode, select which requested read, write, and encryption-key permissions to approve for
each scope. Deselecting every permission still approves the identity with no capabilities; Cancel
declines the request. Quick auth approves all requested permissions. This lets an app test a user
declining optional access without abandoning sign-in.

The `e` action delivers encryption/decryption keys for the approved scope; it does not grant storage
reads or writes. Keys remain usable after a grant expires or is revoked. A directory key covers all
files below that directory, while an exact-path key covers only that file. Use disposable test
identities and request narrow scopes.

If a request contains callback destinations, the result notification offers a return-to-app link.
Callback destinations are untrusted and are only opened after you select that link.

## Integrating an app

Use `startGrantAuthFlow` for new integrations.
[Cookie authentication APIs are deprecated](https://github.com/pubky/pubky-homeserver/pull/546)
in favor of grants. The simulator supports apps using stable JavaScript SDK releases published in
the preceding year, including legacy cookie authentication where those releases require it.

Generate a grant sign-in request in your app using the local testnet:

```ts
import { AuthFlowKind, Pubky } from "@synonymdev/pubky";

const pubky = Pubky.testnet();
const flow = await pubky.startGrantAuthFlow(
  "/pub/example.app/:rw",
  AuthFlowKind.signin(),
  {
    clientId: "example.app",
    relay: "http://localhost:15412/inbox/",
  },
);

// Paste this link into the simulator, or display it as a QR code in your app.
console.log(flow.authorizationUrl);

// Resolves after approval in the simulator.
const session = await flow.awaitApproval();
```

To request scoped encryption keys, use signed approvals and include `e` on the scopes needing keys:

```ts
const encryptedFlow = await pubky.startGrantAuthFlow(
  "/pub/example.app/:rwe",
  AuthFlowKind.signin(),
  {
    clientId: "example.app",
    relay: "http://localhost:15412/inbox/",
    approvalFormat: "signedApprovalV1",
  },
);
// Submit encryptedFlow.authorizationUrl to the simulator.
const encryptedSession = await encryptedFlow.awaitApproval();
// Inspect the approved capabilities: the user may decline e or storage access.
const approved = encryptedSession.capabilities;
const keys = encryptedSession.grant?.encryptionKeys;
```

Signed approvals use HPKE to deliver the approval to the requesting app. The SDK handles this
exchange; requesting `e` requires `signedApprovalV1`. See the
[scoped encryption keys guide](https://github.com/pubky/pubky-homeserver/blob/v0.17.1/docs/scoped-encryption-keys.md)
for deriving keys and handling reduced approvals.

If approval returns HTTP **413** while the app keeps waiting, the signed approval may exceed the
relay's body limit (2 KiB by default). Request fewer or shorter scopes, or configure your local relay
with an appropriate limit following the
[relay guidance](https://github.com/pubky/pubky-homeserver/blob/v0.17.1/docs/scoped-encryption-keys.md#relay-limits).
Restart the request after correcting the limit; the SDK does not fall back to a bare grant.

## Development

```bash
npm install
npm run dev
```

Build the production site with:

```bash
npm run build
```

Run the auth-link parser and SDK-generated grant request tests with:

```bash
npm test
```

Check requester-to-simulator compatibility with the installed SDK:

```bash
npm run test:compatibility
```

CI also tests historical requester SDKs installed in isolation. Its compatibility matrix is refreshed
during SDK upgrades to cover stable releases published in the preceding year, including both legacy
relay formats and grant requests. These tests exercise the simulator's parsing, signed approval
links and encryption scopes, local signup policy, and cookie approval exchange with full, reduced,
and empty permissions. A complete SDK upgrade also requires a live local-testnet browser test for
grant sessions and encryption-key delivery.

To test another requester version locally, install it in a temporary directory and point the shared
suite at that package. For example:

```bash
pubky_requester_dir=$(mktemp -d)
npm install --prefix "$pubky_requester_dir" --no-package-lock --ignore-scripts @synonymdev/pubky@0.9.3
PUBKY_REQUESTER_MODULE="$pubky_requester_dir/node_modules/@synonymdev/pubky" npm run test:compatibility
rm -rf "$pubky_requester_dir"
```
