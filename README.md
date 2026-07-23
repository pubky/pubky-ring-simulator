# Pubky Ring Simulator

> [!WARNING]
> **This is temporary developer tooling and a prototype. It will be replaced.**
> It is not Pubky Ring and must never be used for real identities.

**Live simulator:** [pubky.github.io/pubky-ring-simulator](https://pubky.github.io/pubky-ring-simulator/)

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
admin password.

## Quick auth

Paste or screen-scan a `pubkyauth://` sign-in request and use the primary action:

- If the active identity is already registered, it is used immediately.
- If another registered identity exists, it becomes active and is used.
- If no registered identity exists, the simulator creates one, registers it on the default local
  Homeserver, and approves the sign-in request in one flow.

Registration details remain hidden, including obtaining any server-required registration
credential from the default local admin endpoint.

## Development

```bash
npm install
npm run dev
```

Build the production site with:

```bash
npm run build
```
