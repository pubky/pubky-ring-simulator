---
name: pubky-sdk-upgrade
description: "Upgrade pubky-ring-simulator to a released Pubky SDK, preserve a rolling year of app compatibility, and implement improvements with clear practical value. Use for SDK upgrades, SDK Dependabot PRs, or SDK compatibility audits."
---

# Pubky SDK Upgrade

Keep the simulator up to date so developers can authorize current Pubky apps against the default local testnet. Implement compatibility fixes, necessary migrations, and improvements with a clear practical benefit for local app development. Broad SDK feature coverage is not a goal: a dependency bump can be sufficient when the assessment finds no needed application changes.

This is an on-demand workflow. Its default outcome is an implemented upgrade, verified with automated checks and a local live test, delivered in a pull request. Honor requests limited to assessment or local changes and explicitly selected versions. Do not create recurring jobs merely by invoking the skill.

## Establish the baseline and supported releases

- Read repository instructions, README, manifests, lockfiles, CI, SDK integration, and tests. Discover the current layout; `src/pubky.ts` and its UI consumers in `src/main.ts` are starting points. Record declared and resolved SDK versions. For an existing dependency bump or Dependabot PR, recover the pre-upgrade version from its base or history so intervening changes are still reviewed.
- Resolve the latest published stable JavaScript SDK from npm metadata for `@synonymdev/pubky`: inspect dist-tags, versions, and publication times. Corroborate with upstream releases; distinguish the JavaScript package from server/monorepo releases. Exclude prereleases unless requested, and resolve disagreements before calling a version latest.
- The compatibility commitment covers apps using **every stable JavaScript SDK release published within the preceding calendar year**, including the cutoff date. Compute that cutoff from the invocation date in UTC, minus one calendar year, and record it with the supported version list. Use `npm view @synonymdev/pubky time --json` and `npm view @synonymdev/pubky versions --json`; never infer age from version numbers or Git dates. The simulator itself uses the target SDK; this window governs requester/app interoperability.
- Maintain support for all releases in that window. Retire dedicated compatibility code, dependency aliases, fixtures, CI entries, and documentation for releases outside it when they no longer serve any supported release or current workflow. Do not extend the support guarantee beyond a year. Re-evaluate historical fixtures and the CI requester matrix against publication dates on every upgrade rather than preserving a fixed legacy version forever.

## Assess practical impact

Review every intervening release and applicable migration guidance, including breaking changes, deprecations, changed defaults, fixes that remove workarounds, and new capabilities. If the installed SDK is already current, still assess the supported compatibility window and practical omissions before declaring the simulator current.

Use authoritative evidence tied to the actual target release:

- [Published JavaScript package](https://www.npmjs.com/package/@synonymdev/pubky), including exact-version exports, types, and bundled documentation.
- [Upstream releases](https://github.com/pubky/pubky-homeserver/releases), release-linked PRs, and relevant source diffs.
- [SDK README](https://github.com/pubky/pubky-homeserver/blob/main/pubky-sdk/bindings/js/pkg/README.md) and [JavaScript examples](https://github.com/pubky/pubky-homeserver/tree/main/examples/javascript), resolved to the target tag/commit before relying on their APIs.
- [Developer guide](https://pubky.org/explore/pubkycore/getting-started/) and [Pubky Docker](https://github.com/pubky/pubky-docker) for applicable setup and integration requirements.

Follow renamed source locations as needed. Confirm that a capability ships in the JavaScript package; unreleased `main`, Rust-only APIs, and server features do not establish SDK availability. For team-specific decisions, follow repository Talos instructions: list verbs, start with `talos find`, and consult `talos skills` before agent queries. Keep private team evidence out of public PRs unless sharing is authorized.

Make a concise assessment with the relevant change, source/version, affected simulator behavior, decision, and reason:

- **Implement/migrate:** required compatibility or API changes, and improvements with a clear benefit to developing or testing apps. State the concrete workflow helped; implement useful changes without requiring a separate feature request.
- **Already handled/no app change:** the simulator already supports it, or the SDK handles it internally.
- **Skip:** no clear practical benefit, disproportionate complexity, outside the simulator's scope, or unavailable in the target JavaScript SDK. Supporting a required in-window version is not optional feature work.
- **Blocked:** identify missing evidence, infrastructure, or an unresolved requirement; do not silently call the upgrade complete.

Stay app-agnostic. [pubky-app-templates](https://github.com/pubky/pubky-app-templates) is a useful interoperability client, not a product specification or a required runtime dependency. Preserve the simulator's purpose: disposable in-memory identities, automatic registration, and authentication approval against the default local Pubky Docker services. Do not add mainnet support, configuration UI, key persistence/import/export/recovery, or general SDK demos without a separate scope change.

## Implement the upgrade

- Update the SDK manifest and regenerate the lockfile with the repository's package manager; verify the resolved version and preserve its dependency-range convention. Change related packages only when needed for compatibility. Keep historical requester SDKs in test tooling, not the simulator's production bundle.
- Trace initialization, identity registration and token fallback, auth-link parsing, capabilities, preview/approval, relay exchange, callbacks, error handling, and asynchronous UI state. Migrate deprecated APIs and obsolete workarounds using the target SDK's supported patterns while preserving the required requester compatibility.
- Preserve existing security boundaries: quick auth is sign-in only; regular signup approval targets the fixed local Homeserver; direct signup is unsupported. Keep capability validation and exact-file/directory semantics, revalidation before signing, escaped untrusted UI content, and filtered, user-clicked callbacks. Registration-token fallback must remain conditional on the expected structured SDK error, with local admin credentials sent only to the fixed local admin endpoint. Do not relax these checks merely to make an upgrade or test pass.
- Update affected usage docs, tests, and CI together. Never state the simulator's current SDK version in README; keep it in package manifests/lockfiles and the UI's package-derived display. Historical SDK versions may be named for compatibility tests. Put release analysis in the PR rather than accumulating a release log in README.
- Follow active review requirements, including security review before sensitive implementation and after implementation. Investigate findings and fix confirmed in-scope issues.

## Verify automated and live behavior

Read current CI and run its required checks. The current entry points are `npm ci`, `npm run audit`, `npm run check`, `npm test`, `npm run build`, and `npm run test:compatibility`, including CI's isolated historical requester installs. Refresh that requester matrix with the rolling support window. Distinguish existing failures from regressions; do not suppress either.

Build a requester-to-simulator compatibility matrix from the supported release list. At minimum exercise the oldest and newest supported releases and every distinct or changed authentication contract (request format, capabilities, relay exchange, callbacks, session result). Use shared integration tests or isolated requester installs for additional versions; run every supported release when the matrix is small. Record which releases were tested and the evidence for grouping others; sampled results must not be described as exhaustive verification. If compatibility for part of the required window remains unresolved, report that as incomplete work.

Tests should exercise this project's handling of SDK-generated requests and approval/session exchange, plus focused regressions for changed behavior. Do not test the dependency's own behavior in isolation or add a permanent package alias for every patch release merely to build the matrix.

**A local live test is required for a completed upgrade.** A build, mocked tests, or an in-process relay test alone does not satisfy this requirement:

1. Use the README's default local Pubky Docker stack, following its current setup instructions. Verify the Homeserver, admin service, resolver, and relay are available and compatible with the target SDK; a running older stack is not sufficient evidence. Reuse suitable local infrastructure, preserve existing configuration/data, and keep any broader infrastructure changes separately scoped. Bind test services you start to loopback and clean up only resources created for this task.
2. Run the simulator locally and use a browser with a testnet app or minimal requester. `pubky-app-templates/basic-pubky-app` is a useful starting client; inspect its actual SDK version and select the Ring authorization flow, not its own identity-creation shortcut. A neutral requester using the target SDK is equally valid.
3. Complete a real authorization: generate a request, submit it through simulator quick auth, create/register a disposable identity, receive the app session, and verify the app identity matches the simulator identity. Use that session for a permitted write/read/delete of disposable data under the app's test namespace. Verify existing-identity reuse with another request. Exercise the regular preview/approval, signup, callback, and error/cancellation paths when affected by the upgrade; exercise each older authentication generation still in the support window as well.

Keep private keys, full auth URLs containing relay secrets, registration tokens, cookies, and grants out of logs, screenshots, commits, and reports. Use only disposable local identities/data for validation. Record SDK/client and Homeserver versions, flows tested, and relevant browser/network failures with sensitive values removed.

If live verification cannot be completed after reasonable setup and diagnosis, identify the concrete blocker and retain the work in a draft PR. Do not describe it as a completed, tested upgrade or substitute a testing waiver without the user's direction.

## Deliver the pull request

For a normal upgrade invocation, commit the verified changes on a feature branch, push it to the appropriate remote, and open a PR against the verified upstream default branch. Inspect remotes and follow applicable Git push safeguards. Never push directly to the default branch, merge, or deploy without explicit authorization for that action. Continue an existing upgrade PR when authorized instead of creating a duplicate.

Include the old/target versions, release evidence, practical improvements and migrations, relevant exclusions, the dated compatibility window and tested matrix, and automated/live check outcomes in the PR. Report unresolved serious review findings and mark incomplete work as draft. If remote access prevents delivery, keep the local changes and state what blocked PR creation.

A reasoned no-change result is valid when the simulator already satisfies the target and compatibility window; do not manufacture a diff or empty PR. For a normal upgrade invocation, complete the required checks and local live verification before reaching that conclusion.
