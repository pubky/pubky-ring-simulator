import {
  DirectSignupDeepLink,
  Keypair,
  PublicKey,
  Pubky,
  SigninDeepLink,
  SigninGrantDeepLink,
  SignupDeepLink,
  SignupGrantDeepLink,
  type XCallbackParams,
} from "@synonymdev/pubky";

const TESTNET_HOMESERVER =
  "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo";
const TESTNET_HOMESERVER_PUBLIC_KEY = `pubky${TESTNET_HOMESERVER}`;
const TESTNET_HOMESERVER_ADMIN_URL = "http://127.0.0.1:6288";
const TESTNET_HOMESERVER_ADMIN_PASSWORD = "admin";

export interface SignerIdentity {
  createdAt: string;
  homeserver?: string;
  id: string;
  keypair: Keypair;
  publicKey: string;
}

export type AuthRequestKind = "signin" | "signup";
export type AuthMode = "cookie" | "grant";
export type AuthCallbackOutcome = "success" | "error" | "cancel";

export interface AuthCallbacks {
  xCancel?: string;
  xError?: string;
  xSource?: string;
  xSuccess?: string;
}

export interface AuthRequestPreview {
  authMode: AuthMode;
  capabilities: string[];
  clientId?: string;
  homeserver?: string;
  kind: AuthRequestKind;
  relay: string;
  url: string;
  xCallback?: AuthCallbacks;
}

// There is intentionally no mainnet configuration path.
export const pubky = Pubky.testnet();

export function createIdentity(): SignerIdentity {
  const keypair = Keypair.random();
  const publicKey = keypair.publicKey.toString();

  return {
    createdAt: new Date().toISOString(),
    id: publicKey,
    keypair,
    publicKey,
  };
}

export async function signUpIdentity(identity: SignerIdentity) {
  if (isIdentityReady(identity)) {
    try {
      const resolved = await pubky.getHomeserverOf(identity.keypair.publicKey);
      if (resolved?.toString() === TESTNET_HOMESERVER_PUBLIC_KEY)
        return identity;
    } catch (error) {
      throw pubkyOperationError(error, "resolve");
    }
  }

  await registerIdentity(identity.keypair);

  return {
    ...identity,
    homeserver: TESTNET_HOMESERVER_PUBLIC_KEY,
  };
}

export function isIdentityReady(identity: SignerIdentity) {
  return identity.homeserver === TESTNET_HOMESERVER_PUBLIC_KEY;
}

export async function approveAuthRequest(
  identity: SignerIdentity,
  input: string,
) {
  const request = assertLocalAuthRequest(parseAuthRequest(input));

  try {
    await pubky.signer(identity.keypair).approveAuthRequest(request.url);
  } catch (error) {
    throw pubkyOperationError(error, "approve");
  }

  return request;
}

export function assertSupportedAuthRequest(request: AuthRequestPreview) {
  if (request.kind !== "signin") {
    throw new Error(
      "Use a sign-in request. This tool creates and registers test identities automatically.",
    );
  }

  return request;
}

export function assertLocalAuthRequest(request: AuthRequestPreview) {
  if (
    request.kind === "signup" &&
    request.homeserver !== TESTNET_HOMESERVER_PUBLIC_KEY
  ) {
    throw new Error(
      "This signup request targets a different Homeserver. " +
        "The simulator only supports the default local testnet Homeserver.",
    );
  }

  return request;
}

export function callbackUrlFor(
  request: AuthRequestPreview,
  outcome: AuthCallbackOutcome,
) {
  const value =
    outcome === "success"
      ? request.xCallback?.xSuccess
      : outcome === "error"
        ? request.xCallback?.xError
        : request.xCallback?.xCancel;

  if (!value) return undefined;

  try {
    const protocol = new URL(value).protocol.toLowerCase();
    if (
      ["blob:", "data:", "file:", "javascript:", "vbscript:"].includes(
        protocol,
      )
    )
      return undefined;
    return value;
  } catch {
    return undefined;
  }
}

export function parseAuthRequest(input: string): AuthRequestPreview {
  const link = extractAuthLink(input);
  const candidates = unique([link, normalizeLooseAuthLink(link)]);
  const errors: string[] = [];

  for (const candidate of candidates) {
    const directSignupError = tryParseDirectSignup(candidate);
    if (directSignupError) throw directSignupError;

    const signupFirst = candidate.toLowerCase().includes("signup");
    const parsers = signupFirst
      ? [
          tryParseSignupGrant,
          tryParseSignup,
          tryParseSigninGrant,
          tryParseSignin,
        ]
      : [
          tryParseSigninGrant,
          tryParseSignin,
          tryParseSignupGrant,
          tryParseSignup,
        ];

    for (const parse of parsers) {
      const result = parse(candidate);
      if (result.preview) return result.preview;
      if (result.error) errors.push(result.error);
    }
  }

  throw new Error(errors[0] || "Expected a Pubky auth deeplink.");
}

async function registerIdentity(keypair: Keypair): Promise<void> {
  const signer = pubky.signer(keypair);
  const homeserver = PublicKey.from(TESTNET_HOMESERVER);

  try {
    await signer.signup(homeserver, null);
  } catch (withoutTokenError) {
    if (!isSignupTokenRequired(withoutTokenError))
      throw pubkyOperationError(withoutTokenError, "register");

    const signupToken = await generateSignupToken().catch((error: unknown) => {
      throw pubkyOperationError(error, "register");
    });

    try {
      await signer.signup(homeserver, signupToken);
    } catch (withTokenError) {
      throw pubkyOperationError(withTokenError, "register");
    }
  }
}

async function generateSignupToken() {
  const url = new URL("/generate_signup_token", TESTNET_HOMESERVER_ADMIN_URL);
  const response = await pubky.client.fetch(url.toString(), {
    method: "GET",
    headers: {
      "X-Admin-Password": TESTNET_HOMESERVER_ADMIN_PASSWORD,
    },
  });

  if (!response.ok) {
    throw new Error(
      `Homeserver admin returned ${response.status} ${response.statusText}.`,
    );
  }

  const token = (await response.text()).trim();
  if (!token)
    throw new Error(
      "Homeserver admin returned an empty registration response.",
    );
  return token;
}

function tryParseSignin(url: string) {
  try {
    const link = SigninDeepLink.parse(url);
    return {
      preview: {
        authMode: "cookie" as const,
        capabilities: splitCapabilities(link.capabilities),
        kind: "signin" as const,
        relay: link.baseRelayUrl,
        url: link.toString(),
        xCallback: normalizeCallbacks(link.xCallback),
      },
    };
  } catch (error) {
    return { error: formatError(error) };
  }
}

function tryParseSignup(url: string) {
  try {
    const link = SignupDeepLink.parse(url);
    return {
      preview: {
        authMode: "cookie" as const,
        capabilities: splitCapabilities(link.capabilities),
        homeserver: link.homeserver.toString(),
        kind: "signup" as const,
        relay: link.baseRelayUrl,
        url: link.toString(),
        xCallback: normalizeCallbacks(link.xCallback),
      },
    };
  } catch (error) {
    return { error: formatError(error) };
  }
}

function tryParseSigninGrant(url: string) {
  try {
    const link = SigninGrantDeepLink.parse(url);
    return {
      preview: {
        authMode: "grant" as const,
        capabilities: splitCapabilities(link.capabilities),
        clientId: link.clientId,
        kind: "signin" as const,
        relay: link.baseRelayUrl,
        url: link.toString(),
        xCallback: normalizeCallbacks(link.xCallback),
      },
    };
  } catch (error) {
    return { error: formatError(error) };
  }
}

function tryParseSignupGrant(url: string) {
  try {
    const link = SignupGrantDeepLink.parse(url);
    return {
      preview: {
        authMode: "grant" as const,
        capabilities: splitCapabilities(link.capabilities),
        clientId: link.clientId,
        homeserver: link.homeserver.toString(),
        kind: "signup" as const,
        relay: link.baseRelayUrl,
        url: link.toString(),
        xCallback: normalizeCallbacks(link.xCallback),
      },
    };
  } catch (error) {
    return { error: formatError(error) };
  }
}

function tryParseDirectSignup(url: string) {
  try {
    const link = DirectSignupDeepLink.parse(url);
    const homeserver = link.homeserver.toString();
    return new Error(
      "Direct signup requests are not supported. Add a test identity instead; " +
        `the simulator registers it on its default local Homeserver (${homeserver}).`,
    );
  } catch {
    return undefined;
  }
}

function normalizeCallbacks(callbacks: XCallbackParams) {
  const normalized: AuthCallbacks = {
    xCancel: callbacks.xCancel || undefined,
    xError: callbacks.xError || undefined,
    xSource: callbacks.xSource || undefined,
    xSuccess: callbacks.xSuccess || undefined,
  };

  return Object.values(normalized).some(Boolean) ? normalized : undefined;
}

function extractAuthLink(input: string) {
  const cleanInput = input.trim().replace(/&amp;/g, "&");
  const match = cleanInput.match(/(?:pubkyauth|pubkyring):\/\/[^\s<>"'`]+/i);
  const link = match ? match[0] : cleanInput;
  const trimmed = match && match[0] !== cleanInput
    ? link.replace(/[),.;]+$/, "")
    : link;

  if (!trimmed) throw new Error("Paste or scan a Pubky auth link first.");
  return trimmed;
}

function normalizeLooseAuthLink(link: string) {
  return link.replace(/^pubkyauth:\/\/\/?\?/i, "pubkyauth://signin?");
}

function splitCapabilities(capabilities: string) {
  return capabilities ? capabilities.split(",").filter(Boolean) : [];
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function isSignupTokenRequired(error: unknown) {
  if (!(error instanceof Error) || error.name !== "RequestError") return false;

  const data = isRecord(error) ? error.data : undefined;
  return (
    isRecord(data) &&
    data.statusCode === 400 &&
    error.message.toLowerCase().includes("token required")
  );
}

type PubkyOperation = "approve" | "register" | "resolve";

function pubkyOperationError(error: unknown, operation: PubkyOperation) {
  const detail = formatError(error);
  const name = error instanceof Error ? error.name : "";
  let message: string;

  if (name === "PkarrError") {
    message = `PKARR could not resolve the identity's local Homeserver. ${detail}`;
  } else if (name === "AuthenticationError") {
    const subject =
      operation === "approve"
        ? "authorization"
        : operation === "resolve"
          ? "Homeserver resolution"
          : "identity registration";
    message = `The default local Homeserver rejected the ${subject}. ${detail}`;
  } else if (name === "InvalidInput") {
    const subject = operation === "approve" ? "auth request" : "identity data";
    message = `The Pubky SDK rejected the ${subject}. ${detail}`;
  } else if (operation === "approve") {
    message = `Could not deliver the authorization to the request's relay. ${detail}`;
  } else if (operation === "resolve") {
    message = `Could not check the identity on the local testnet. ${detail}`;
  } else {
    message =
      "Could not register the identity on the default local Homeserver. " +
      `Start Pubky Docker and try again. ${detail}`;
  }

  return new Error(message, { cause: error });
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
