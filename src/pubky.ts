import {
  Keypair,
  PublicKey,
  Pubky,
  SigninDeepLink,
  SignupDeepLink,
} from "@synonymdev/pubky";
import type { Session } from "@synonymdev/pubky";

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

export interface AuthRequestPreview {
  capabilities: string[];
  homeserver?: string;
  kind: AuthRequestKind;
  relay: string;
  url: string;
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
      throw localTestnetError(error);
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
  const request = parseAuthRequest(input);
  await pubky.signer(identity.keypair).approveAuthRequest(request.url);
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

export function parseAuthRequest(input: string): AuthRequestPreview {
  const link = extractAuthLink(input);
  const candidates = unique([link, normalizeLooseAuthLink(link)]);
  const errors: string[] = [];

  for (const candidate of candidates) {
    const signupFirst = candidate.toLowerCase().includes("signup");
    const parsers = signupFirst
      ? [tryParseSignup, tryParseSignin]
      : [tryParseSignin, tryParseSignup];

    for (const parse of parsers) {
      const result = parse(candidate);
      if (result.preview) return result.preview;
      if (result.error) errors.push(result.error);
    }
  }

  throw new Error(errors[0] || "Expected a Pubky auth deeplink.");
}

async function registerIdentity(keypair: Keypair): Promise<Session> {
  const signer = pubky.signer(keypair);
  const homeserver = PublicKey.from(TESTNET_HOMESERVER);

  try {
    return await signer.signup(homeserver, null);
  } catch (withoutTokenError) {
    if (!isSignupTokenRequired(withoutTokenError))
      throw localTestnetError(withoutTokenError);

    const signupToken = await generateSignupToken().catch((error: unknown) => {
      throw localTestnetError(error);
    });

    try {
      return await signer.signup(homeserver, signupToken);
    } catch (withTokenError) {
      throw localTestnetError(withTokenError);
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

function localTestnetError(error: unknown) {
  return new Error(
    `Could not reach the default local testnet Homeserver. Start Pubky Docker and try again. ${formatError(error)}`,
    { cause: error },
  );
}

function tryParseSignin(url: string) {
  try {
    const link = SigninDeepLink.parse(url);
    return {
      preview: {
        capabilities: splitCapabilities(link.capabilities),
        kind: "signin" as const,
        relay: link.baseRelayUrl,
        url: link.toString(),
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
        capabilities: splitCapabilities(link.capabilities),
        homeserver: link.homeserver.toString(),
        kind: "signup" as const,
        relay: link.baseRelayUrl,
        url: link.toString(),
      },
    };
  } catch (error) {
    return { error: formatError(error) };
  }
}

function extractAuthLink(input: string) {
  const cleanInput = input.trim().replace(/&amp;/g, "&");
  const match = cleanInput.match(/(?:pubkyauth|pubkyring):\/\/[^\s<>"'`]+/i);
  const link = match ? match[0] : cleanInput;
  const trimmed = link.replace(/[),.;]+$/, "");

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

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
