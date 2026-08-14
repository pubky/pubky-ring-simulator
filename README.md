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
docker compose --profile backend up -d
```

The simulator assumes Pubky Docker's default Homeserver identity, local ports, admin endpoint, and
admin password. Grant requests require a Homeserver build with grant authentication support, so use
an up-to-date Pubky Docker environment.

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

If a request contains callback destinations, the result notification offers a return-to-app link.
Callback destinations are untrusted and are only opened after you select that link.

## Development

```bash
npm install
npm run dev
```

Build the production site with:

```bash
npm run build
```

Run the auth-link parser tests with:

```bash
npm test
```
