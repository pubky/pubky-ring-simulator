import { toSvg } from "jdenticon/browser";
import "./style.css";
import {
  approveAuthRequest,
  assertSupportedAuthRequest,
  createIdentity,
  isIdentityReady,
  parseAuthRequest,
  signUpIdentity,
  type AuthRequestPreview,
  type SignerIdentity,
} from "./pubky";

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
}

declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorConstructor;
  }
}

interface ApprovalHistoryItem {
  at: string;
  capabilities: string[];
  publicKey: string;
}

interface LoginFeedback {
  detail?: string;
  kind: "progress" | "success" | "error";
  title: string;
}

type Route = "identities" | "identity" | "rename" | "authorize" | "auth";

interface State {
  activeIdentityId?: string;
  approvals: ApprovalHistoryItem[];
  authInput: string;
  authRequest?: AuthRequestPreview;
  busy?: string;
  error?: string;
  identities: SignerIdentity[];
  identityNames: Record<string, string>;
  loginFeedback?: LoginFeedback;
  notice?: string;
  scanActive: boolean;
  scanSource?: "camera" | "screen";
}

const PUBKY_DOCKER_URL = "https://github.com/pubky/pubky-docker";
const PROJECT_URL = "https://github.com/pubky/pubky-ring-simulator";
const RING_LOGO_URL = "https://pubkyring.app/pubky-ring-logo.svg";
const app = getAppElement();
const htmlEscapes: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;",
};
const state: State = {
  approvals: [],
  authInput: "",
  identities: [],
  identityNames: {},
  scanActive: false,
};

let scanStream: MediaStream | undefined;
let scanDetector: BarcodeDetectorLike | undefined;
let scanTimer: number | undefined;
let scanCanvas: HTMLCanvasElement | undefined;
let loginFeedbackTimer: number | undefined;

app.addEventListener("click", handleClick);
app.addEventListener("submit", handleSubmit);
app.addEventListener("input", handleInput);
app.addEventListener("paste", handlePaste);
window.addEventListener("hashchange", handleRouteChange);

render();

function render() {
  const route = currentRoute();

  app.innerHTML = `
    <main class="site-shell">
      ${developerBanner()}

      <div class="simulator-layout">
        ${modeSwitcher(route)}

        <section class="phone-stage" aria-label="Pubky Ring Simulator prototype">
          <div class="phone">
            <span class="phone-button phone-button-volume-up" aria-hidden="true"></span>
            <span class="phone-button phone-button-volume-down" aria-hidden="true"></span>
            <span class="phone-button phone-button-power" aria-hidden="true"></span>

            <div class="phone-screen">
              <div class="phone-island" aria-hidden="true">
                <span></span>
              </div>

              <div class="app-surface">
                ${appHeader(route)}
                <div class="screen-content">
                  ${pageForRoute(route)}
                </div>
                ${loginFeedbackView()}
              </div>
            </div>
          </div>
        </section>
      </div>

      <footer class="site-footer">
        <span>Identities disappear on page reload.</span>
        <a href="${PROJECT_URL}" target="_blank" rel="noreferrer">
          ${githubIcon()} GitHub project ${externalIcon()}
        </a>
      </footer>
    </main>
  `;

  attachScanVideo();
}

function developerBanner() {
  return `
    <aside class="developer-banner">
      <span class="banner-icon" aria-hidden="true">${codeIcon()}</span>
      <div>
        <strong>Developer tool · local testnet only</strong>
        <p>
          This prototype only works while the default Pubky testnet is running on your machine.
          <a href="${PUBKY_DOCKER_URL}" target="_blank" rel="noreferrer">
            Start it with Pubky Docker ${externalIcon()}
          </a>
        </p>
      </div>
    </aside>
  `;
}

function loginFeedbackView() {
  const feedback = state.loginFeedback;
  if (!feedback) return "";

  const icon =
    feedback.kind === "progress"
      ? '<span class="login-feedback-spinner" aria-hidden="true"></span>'
      : feedback.kind === "success"
        ? checkIcon()
        : closeIcon();

  return `
    <div
      class="login-feedback ${feedback.kind}"
      role="${feedback.kind === "error" ? "alert" : "status"}"
      aria-live="${feedback.kind === "error" ? "assertive" : "polite"}"
    >
      <span class="login-feedback-icon">${icon}</span>
      <span>
        <strong>${escapeHtml(feedback.title)}</strong>
        ${feedback.detail ? `<small>${escapeHtml(feedback.detail)}</small>` : ""}
      </span>
    </div>
  `;
}

function appHeader(route: Route) {
  const backHref = appBackHref(route);

  return `
    <header class="app-header">
      ${
        backHref
          ? `
            <a class="app-back" href="${backHref}" aria-label="Go back">
              ${arrowLeftIcon()}
            </a>
          `
          : ""
      }
      <a class="brand" href="#/identities" aria-label="Pubky Ring Simulator home">
        <img src="${RING_LOGO_URL}" alt="Pubky Ring">
      </a>
    </header>
  `;
}

function pageForRoute(route: Route) {
  if (route === "auth") return authPage();
  if (route === "authorize") return authorizePage();
  if (route === "rename") return renamePage();
  if (route === "identity") return identityDetailPage();
  return identitiesPage();
}

function identitiesPage() {
  return `
    <section class="screen-section identity-screen">
      <div class="identity-list">${state.identities.map(identityCard).join("")}</div>
      <form id="create-identity-form" class="add-pubky-form">
        <button class="button add-pubky wide" type="submit" ${disabledAttr()}>
          ${plusIcon()} Add pubky
        </button>
      </form>
    </section>
  `;
}

function identityCard(identity: SignerIdentity, index: number) {
  const active = identity.id === state.activeIdentityId;

  return `
    <article class="identity-card">
      <button
        class="identity-summary"
        type="button"
        data-identity-id="${escapeHtml(identity.id)}"
        aria-pressed="${String(active)}"
        ${disabledAttr()}
      >
        ${identityAvatar(identity)}
        <span class="identity-copy">
          <strong>${escapeHtml(identityName(identity))}</strong>
          <small>${escapeHtml(overviewPubky(identity.publicKey))}</small>
        </span>
        <span class="identity-chevron" aria-hidden="true">&gt;</span>
      </button>
      <button
        class="identity-authorize"
        type="button"
        data-authorize-identity-id="${escapeHtml(identity.id)}"
        ${disabledAttr()}
      >
        ${scanIcon()} Authorize
      </button>
      <span class="identity-number" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span>
    </article>
  `;
}

function identityDetailPage() {
  const identity = detailIdentity();
  if (!identity) return identitiesPage();

  return `
    <section class="screen-section identity-detail-screen">
      <div class="identity-detail-card">
        <div class="identity-detail">
          ${identityAvatar(identity)}
          <div class="identity-detail-copy">
            <strong>${escapeHtml(identityName(identity))}</strong>
            <small>${escapeHtml(identity.publicKey)}</small>
          </div>
        </div>
        <div class="identity-detail-actions">
          <button
            class="identity-authorize detail-authorize"
            type="button"
            data-authorize-identity-id="${escapeHtml(identity.id)}"
            ${disabledAttr()}
          >
            ${scanIcon()} Authorize
          </button>
        </div>
      </div>
      <div class="identity-secondary-actions">
        <button
          class="identity-rename"
          type="button"
          data-rename-identity-id="${escapeHtml(identity.id)}"
          ${disabledAttr()}
        >
          ${pencilIcon()} Rename
        </button>
        <button
          class="identity-delete"
          type="button"
          data-delete-identity-id="${escapeHtml(identity.id)}"
          ${disabledAttr()}
        >
          ${trashIcon()} Delete
        </button>
      </div>
    </section>
  `;
}

function renamePage() {
  const identity = renameIdentity();
  if (!identity) return identitiesPage();

  return `
    <section class="screen-section rename-screen">
      <div class="rename-heading">
        <h1>Rename</h1>
      </div>

      <div class="rename-identity">
        ${identityAvatar(identity)}
      </div>

      <form id="rename-form" class="rename-form">
        <label>
          Identity name
          <input
            name="name"
            type="text"
            value="${escapeHtml(identityName(identity))}"
            maxlength="40"
            autocomplete="off"
            required
            autofocus
          >
        </label>
        <button class="button accent wide rename-save" type="submit" ${disabledAttr()}>
          Save
        </button>
      </form>
    </section>
  `;
}

function authorizePage() {
  const identity = authorizeIdentity();
  if (!identity) return identitiesPage();

  return `
    <section class="screen-section regular-authorize-screen">
      <div class="authorize-heading">
        <h1>Authorize</h1>
      </div>

      <div class="authorize-identity">
        ${identityAvatar(identity)}
        <div>
          <strong>${escapeHtml(identityName(identity))}</strong>
          <small>${escapeHtml(shortPubky(identity.publicKey))}</small>
        </div>
      </div>

      <div class="authorize-actions">
        <button id="paste-authorize-link" class="button authorize-source wide" type="button" ${disabledAttr()}>
          ${clipboardIcon()} Paste link
        </button>
        <div class="authorize-divider"><span>or</span></div>

        ${
          state.scanActive
            ? `
              <button id="stop-scan" class="button authorize-source wide" type="button">
                ${closeIcon()} Stop camera
              </button>
              ${captureView()}
            `
            : `
              <button id="start-authorize-scan" class="button authorize-source wide" type="button" ${disabledAttr()}>
                ${scanIcon()} Use camera
              </button>
            `
        }
        ${state.error ? `<p class="authorize-error">${escapeHtml(state.error)}</p>` : ""}
      </div>
    </section>
  `;
}

function authPage() {
  return `
    <section class="screen-section shortcut-auth-screen">
      <label class="shortcut-auth-field">
        <span>Auth link</span>
        <textarea
          id="shortcut-auth-input"
          class="shortcut-auth-input"
          name="auth"
          rows="7"
          autocapitalize="none"
          autocomplete="off"
          spellcheck="false"
          placeholder="Paste Auth link"
          autofocus
          ${disabledAttr()}
        >${escapeHtml(state.authInput)}</textarea>
      </label>
    </section>
  `;
}

function captureView() {
  const label =
    state.scanSource === "camera"
      ? "Looking for a QR code with the camera"
      : "Looking for a QR code on screen";

  return `
    <div class="capture-view">
      <video id="scan-video" autoplay muted playsinline></video>
      <span><i></i> ${label}</span>
    </div>
  `;
}


function modeSwitcher(route: Route) {
  const regularActive = route !== "auth";

  return `
    <nav class="mode-switcher" aria-label="Simulator mode">
      <a
        href="#/identities"
        class="${regularActive ? "active" : ""}"
        ${regularActive ? 'aria-current="page"' : ""}
      >
        <span class="mode-icon" aria-hidden="true">${keyringIcon()}</span>
        <span class="mode-copy">
          <strong>Regular</strong>
        </span>
      </a>
      <a
        href="#/auth"
        class="shortcut ${route === "auth" ? "active" : ""}"
        ${route === "auth" ? 'aria-current="page"' : ""}
      >
        <span class="mode-icon" aria-hidden="true">${boltIcon()}</span>
        <span class="mode-copy">
          <strong>Shortcut</strong>
        </span>
      </a>
    </nav>
  `;
}

function handleClick(event: MouseEvent) {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const authorizeButton = target.closest<HTMLButtonElement>(
    "[data-authorize-identity-id]",
  );
  if (authorizeButton?.dataset.authorizeIdentityId) {
    setActiveIdentityId(authorizeButton.dataset.authorizeIdentityId);
    state.authInput = "";
    state.authRequest = undefined;
    clearStatus();
    window.location.hash = authorizeHref(
      authorizeButton.dataset.authorizeIdentityId,
    );
    return;
  }

  const deleteButton = target.closest<HTMLButtonElement>(
    "[data-delete-identity-id]",
  );
  if (deleteButton?.dataset.deleteIdentityId) {
    deleteIdentity(deleteButton.dataset.deleteIdentityId);
    return;
  }

  const renameButton = target.closest<HTMLButtonElement>(
    "[data-rename-identity-id]",
  );
  if (renameButton?.dataset.renameIdentityId) {
    setActiveIdentityId(renameButton.dataset.renameIdentityId);
    clearStatus();
    window.location.hash = renameHref(renameButton.dataset.renameIdentityId);
    return;
  }

  const identityButton =
    target.closest<HTMLButtonElement>("[data-identity-id]");
  if (identityButton?.dataset.identityId) {
    setActiveIdentityId(identityButton.dataset.identityId);
    clearStatus();
    window.location.hash = identityDetailHref(identityButton.dataset.identityId);
    return;
  }

  const button = target.closest<HTMLButtonElement>("button");
  if (!button || button.disabled) return;

  switch (button.id) {
    case "start-authorize-scan":
      void handleStartScan("camera");
      break;
    case "paste-authorize-link":
      void handlePasteAuthorizeLink();
      break;
    case "stop-scan":
      stopScanCapture("QR capture stopped.");
      break;
  }
}

function handleSubmit(event: SubmitEvent) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;

  event.preventDefault();
  if (state.busy) return;

  switch (form.id) {
    case "create-identity-form":
      void handleCreateIdentity();
      break;
    case "rename-form":
      handleRename(form);
      break;
  }
}

function handleInput(event: Event) {
  const input = event.target;
  if (!(input instanceof HTMLTextAreaElement)) return;
  if (input.id !== "shortcut-auth-input") return;

  state.authInput = input.value;
  state.authRequest = undefined;

  if (
    event instanceof InputEvent &&
    event.inputType === "insertFromPaste" &&
    input.value.trim() &&
    !state.busy
  ) {
    void handleQuickAuth(input.value);
  }
}

function handlePaste(event: ClipboardEvent) {
  const input = event.target;
  if (!(input instanceof HTMLTextAreaElement)) return;
  if (input.id !== "shortcut-auth-input" || state.busy) return;

  const authLink = event.clipboardData?.getData("text").trim();
  if (!authLink) return;

  event.preventDefault();
  input.value = authLink;
  state.authInput = authLink;
  state.authRequest = undefined;
  void handleQuickAuth(authLink);
}

async function handleCreateIdentity() {
  await run("Creating a fresh test identity…", async () => {
    const identity = createIdentity();
    setActiveIdentity(identity);
    updateBusy("Registering it on your local testnet…");
    setActiveIdentity(await signUpIdentity(identity));
    setNotice(`${identityName(identity)} is ready.`);
  });
}

function handleRename(form: HTMLFormElement) {
  const identity = renameIdentity();
  if (!identity) return;

  const name = formValue(new FormData(form), "name").trim();
  if (!name) return;

  state.identityNames[identity.id] = name;
  clearStatus();
  window.location.hash = identityDetailHref(identity.id);
}

async function handleQuickAuth(authLink: string) {
  state.authInput = authLink;
  beginLoginFeedback("Signing in…");

  await run("Checking the local auth request…", async () => {
    const request = assertSupportedAuthRequest(
      parseAuthRequest(state.authInput),
    );
    state.authRequest = request;
    const identity = await identityForQuickAuth();

    updateBusy(`Signing in as ${identityName(identity)}…`);
    await approveAuthRequest(identity, request.url);
    state.approvals = [
      {
        at: new Date().toISOString(),
        capabilities: request.capabilities,
        publicKey: identity.publicKey,
      },
      ...state.approvals,
    ].slice(0, 5);
    setNotice(`Signed in as ${identityName(identity)}.`);
  });

  if (state.error) {
    showLoginFeedback("Login failed", "error", state.error);
  } else {
    state.authInput = "";
    state.authRequest = undefined;
    showLoginFeedback("Logged in", "success");
  }
}

async function handlePasteAuthorizeLink() {
  if (!navigator.clipboard?.readText) {
    setError("Clipboard access is not available in this browser.");
    render();
    return;
  }

  try {
    const input = await navigator.clipboard.readText();
    if (!input.trim()) throw new Error("The clipboard does not contain a link.");
    await handleAuthorizeInput(input);
  } catch (error) {
    setError(error);
    render();
  }
}

async function handleAuthorizeInput(input: string) {
  const identity = authorizeIdentity();
  if (!identity) return;

  state.authInput = input;
  beginLoginFeedback("Signing in…");

  await run("Approving auth request…", async () => {
    const request = parseAuthRequest(state.authInput);
    state.authRequest = request;
    const readyIdentity = await signUpIdentity(identity);
    setActiveIdentity(readyIdentity);
    await approveAuthRequest(readyIdentity, request.url);
    state.approvals = [
      {
        at: new Date().toISOString(),
        capabilities: request.capabilities,
        publicKey: readyIdentity.publicKey,
      },
      ...state.approvals,
    ].slice(0, 5);
    setNotice(`Authorized with ${identityName(readyIdentity)}.`);
  });

  if (state.error) {
    showLoginFeedback("Login failed", "error", state.error);
    return;
  }

  state.authInput = "";
  state.authRequest = undefined;
  showLoginFeedback("Logged in", "success");
  window.location.hash = identityDetailHref(identity.id);
}

async function identityForQuickAuth() {
  const active = activeIdentity();
  const readyIdentity =
    active && isIdentityReady(active)
      ? active
      : state.identities.find(isIdentityReady);

  if (readyIdentity) {
    setActiveIdentityId(readyIdentity.id);
    updateBusy("Checking the active identity…");
    const verifiedIdentity = await signUpIdentity(readyIdentity);
    setActiveIdentity(verifiedIdentity);
    return verifiedIdentity;
  }

  const identity = active || createIdentity();
  setActiveIdentity(identity);
  updateBusy(
    active ? "Finishing identity setup…" : "Creating your first test identity…",
  );
  const signedUpIdentity = await signUpIdentity(identity);
  setActiveIdentity(signedUpIdentity);
  return signedUpIdentity;
}

async function handleStartScan(label: "camera" | "screen") {
  if (!window.BarcodeDetector) {
    setError(
      "Screen QR scanning needs Chrome or Edge. You can paste the auth link instead.",
    );
    render();
    return;
  }

  if (!navigator.mediaDevices?.getDisplayMedia) {
    setError("Screen capture is not available in this browser.");
    render();
    return;
  }

  const BarcodeDetector = window.BarcodeDetector;

  await run("Starting screen capture…", async () => {
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: false,
      video: { frameRate: { ideal: 8, max: 12 } },
    });
    stream.getVideoTracks().forEach((track) => {
      track.addEventListener("ended", () => {
        stopScanCapture("Screen capture ended.");
      });
    });
    scanDetector = detector;
    scanStream = stream;
    state.scanActive = true;
    state.scanSource = label;
    clearStatus();
  });

  if (state.scanActive) queueScan();
}

function attachScanVideo() {
  const video = document.querySelector<HTMLVideoElement>("#scan-video");
  if (!video || !scanStream) return;

  if (video.srcObject !== scanStream) video.srcObject = scanStream;
  void video.play().catch((error: unknown) => {
    if (!state.scanActive) return;
    setError(error);
    stopScanCapture();
  });
}

function queueScan() {
  window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(() => {
    void scanScreenFrame();
  }, 250);
}

async function scanScreenFrame() {
  if (!state.scanActive || !scanDetector) return;

  const video = document.querySelector<HTMLVideoElement>("#scan-video");
  if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    queueScan();
    return;
  }

  try {
    const rawValue = await detectQrValue(video);
    if (!state.scanActive) return;

    if (!rawValue) {
      queueScan();
      return;
    }

    if (currentRoute() === "authorize") {
      stopScanCapture("Local auth QR found.");
      void handleAuthorizeInput(rawValue);
      return;
    }

    state.authInput = rawValue;
    state.authRequest = assertSupportedAuthRequest(
      parseAuthRequest(rawValue),
    );
    stopScanCapture("Local auth QR found.");
  } catch (error) {
    if (!state.scanActive) return;
    setError(error);
    stopScanCapture();
  }
}

async function detectQrValue(video: HTMLVideoElement) {
  if (!scanDetector || !video.videoWidth || !video.videoHeight)
    return undefined;

  const canvas = scanCanvas || document.createElement("canvas");
  scanCanvas = canvas;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not read the QR capture frame.");

  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const barcodes = await scanDetector.detect(canvas);
  return barcodes.find((barcode) => barcode.rawValue)?.rawValue;
}

function stopScanCapture(notice?: string) {
  window.clearTimeout(scanTimer);
  scanTimer = undefined;
  scanStream?.getTracks().forEach((track) => {
    track.stop();
  });
  scanStream = undefined;
  scanDetector = undefined;
  state.scanActive = false;
  state.scanSource = undefined;

  if (notice) setNotice(notice);
  render();
}

function handleRouteChange() {
  const route = currentRoute();
  const scanBelongsToRoute =
    (route === "auth" && state.scanSource === "screen") ||
    (route === "authorize" && state.scanSource === "camera");

  if (!scanBelongsToRoute && state.scanActive) {
    stopScanCapture();
    return;
  }
  render();
}

function activeIdentity() {
  return state.identities.find(
    (identity) => identity.id === state.activeIdentityId,
  );
}

function detailIdentity() {
  const id = detailIdentityId();
  return state.identities.find((identity) => identity.id === id);
}

function authorizeIdentity() {
  const id = authorizeIdentityId();
  return state.identities.find((identity) => identity.id === id);
}

function renameIdentity() {
  const id = renameIdentityId();
  return state.identities.find((identity) => identity.id === id);
}

function deleteIdentity(id: string) {
  state.identities = state.identities.filter((identity) => identity.id !== id);
  delete state.identityNames[id];
  if (state.activeIdentityId === id) {
    setActiveIdentityId(state.identities[0]?.id);
  }
  clearStatus();
  window.location.hash = "#/identities";
}

function setActiveIdentity(identity: SignerIdentity) {
  const index = state.identities.findIndex((item) => item.id === identity.id);
  if (index === -1) {
    state.identities = [...state.identities, identity];
  } else {
    state.identities[index] = identity;
  }
  setActiveIdentityId(identity.id);
}

function setActiveIdentityId(id: string | undefined) {
  state.activeIdentityId = id;
}

async function run(label: string, task: () => Promise<void>) {
  state.busy = label;
  clearStatus();
  render();

  try {
    await task();
  } catch (error) {
    setError(error);
  } finally {
    state.busy = undefined;
    render();
  }
}

function updateBusy(label: string) {
  state.busy = label;
  render();
}

function identityName(identity: SignerIdentity) {
  return identityNameFromPublicKey(identity.publicKey);
}

function identityNameFromPublicKey(publicKey: string) {
  const index = state.identities.findIndex(
    (identity) => identity.publicKey === publicKey,
  );
  const identity = state.identities[index];
  if (identity && state.identityNames[identity.id])
    return state.identityNames[identity.id];
  return `Test identity ${index >= 0 ? String(index + 1).padStart(2, "0") : ""}`.trim();
}

function identityAvatar(identity: SignerIdentity) {
  const seed = identity.publicKey.startsWith("pk:")
    ? identity.publicKey.slice(3).trim()
    : identity.publicKey.trim();

  return `
    <span class="identity-avatar" aria-hidden="true">${toSvg(seed, 48)}</span>
  `;
}

function setNotice(notice: string) {
  state.notice = notice;
  state.error = undefined;
}

function setError(error: unknown) {
  state.error = formatError(error);
  state.notice = undefined;
}

function clearStatus() {
  state.error = undefined;
  state.notice = undefined;
}

function beginLoginFeedback(title: string, detail?: string) {
  window.clearTimeout(loginFeedbackTimer);
  loginFeedbackTimer = undefined;
  state.loginFeedback = { detail, kind: "progress", title };
}

function showLoginFeedback(
  title: string,
  kind: "success" | "error",
  detail?: string,
) {
  window.clearTimeout(loginFeedbackTimer);
  const feedback: LoginFeedback = { detail, kind, title };
  state.loginFeedback = feedback;
  render();

  loginFeedbackTimer = window.setTimeout(
    () => {
      if (state.loginFeedback !== feedback) return;
      state.loginFeedback = undefined;
      loginFeedbackTimer = undefined;
      render();
    },
    kind === "success" ? 4_500 : 7_000,
  );
}

function currentRoute(): Route {
  if (window.location.hash === "#/auth") return "auth";
  if (authorizeIdentity()) return "authorize";
  if (renameIdentity()) return "rename";
  if (detailIdentity()) return "identity";
  return "identities";
}

function detailIdentityId() {
  const prefix = "#/identities/";
  if (!window.location.hash.startsWith(prefix)) return undefined;

  try {
    return decodeURIComponent(window.location.hash.slice(prefix.length));
  } catch {
    return undefined;
  }
}

function identityDetailHref(id: string) {
  return `#/identities/${encodeURIComponent(id)}`;
}

function authorizeIdentityId() {
  const prefix = "#/authorize/";
  if (!window.location.hash.startsWith(prefix)) return undefined;

  try {
    return decodeURIComponent(window.location.hash.slice(prefix.length));
  } catch {
    return undefined;
  }
}

function authorizeHref(id: string) {
  return `#/authorize/${encodeURIComponent(id)}`;
}

function renameIdentityId() {
  const prefix = "#/rename/";
  if (!window.location.hash.startsWith(prefix)) return undefined;

  try {
    return decodeURIComponent(window.location.hash.slice(prefix.length));
  } catch {
    return undefined;
  }
}

function renameHref(id: string) {
  return `#/rename/${encodeURIComponent(id)}`;
}

function appBackHref(route: Route) {
  if (route === "identity") return "#/identities";
  if (route === "rename") {
    const identity = renameIdentity();
    return identity ? identityDetailHref(identity.id) : "#/identities";
  }
  if (route === "authorize") {
    const identity = authorizeIdentity();
    return identity ? identityDetailHref(identity.id) : "#/identities";
  }
  return undefined;
}

function formValue(formData: FormData, name: string) {
  return String(formData.get(name) || "");
}

function shortPubky(value: string) {
  if (value.length <= 22) return value;
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

function overviewPubky(value: string) {
  const pubky = value.replace(/^pubky/i, "");
  if (pubky.length <= 10) return pubky;
  return `${pubky.slice(0, 5)}...${pubky.slice(-5)}`;
}

function disabledAttr(disabled = false) {
  return state.busy || disabled ? "disabled" : "";
}

function getAppElement() {
  const element = document.querySelector<HTMLDivElement>("#app");
  if (!element) throw new Error("Missing #app element");
  return element;
}

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function escapeHtml(value: unknown) {
  return String(value).replace(
    /[&<>"']/g,
    (character) => htmlEscapes[character],
  );
}

function svgIcon(path: string, viewBox = "0 0 24 24") {
  return `<svg viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

function checkIcon() {
  return svgIcon('<path d="m5 12 4 4L19 6"/>');
}

function closeIcon() {
  return svgIcon('<path d="m6 6 12 12M18 6 6 18"/>');
}

function clipboardIcon() {
  return svgIcon(
    '<path d="M9 5H7a2 2 0 0 0-2 2v12h14V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/>',
  );
}

function pencilIcon() {
  return svgIcon(
    '<path d="m4 20 4.2-1 10.4-10.4a2 2 0 0 0-2.8-2.8L5.4 16.2 4 20Z"/><path d="m14.5 7.1 2.8 2.8"/>',
  );
}

function arrowLeftIcon() {
  return svgIcon('<path d="m15 18-6-6 6-6"/>');
}

function plusIcon() {
  return svgIcon('<path d="M12 5v14M5 12h14"/>');
}

function keyringIcon() {
  return svgIcon(
    '<circle cx="9" cy="14" r="4"/><path d="m12 11 7-7m-3 3 2 2M5 5l2 2"/>',
  );
}

function boltIcon() {
  return svgIcon('<path d="m13 2-9 12h7l-1 8 9-12h-7l1-8Z"/>');
}

function codeIcon() {
  return svgIcon('<path d="m8 9-3 3 3 3m8-6 3 3-3 3m-2-9-4 12"/>');
}

function trashIcon() {
  return svgIcon(
    '<path d="M4 7h16m-10 4v5m4-5v5M9 7l1-3h4l1 3m3 0-1 13H7L6 7"/>',
  );
}

function scanIcon() {
  return svgIcon(
    '<path d="M4 8V5a1 1 0 0 1 1-1h3m8 0h3a1 1 0 0 1 1 1v3m0 8v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/>',
  );
}

function externalIcon() {
  return svgIcon(
    '<path d="M14 5h5v5m0-5-8 8"/><path d="M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  );
}

function githubIcon() {
  return svgIcon(
    '<path d="M15 22v-3.9c0-1 .1-1.5-.5-2.1 2.8-.3 5.7-1.4 5.7-6.2 0-1.3-.5-2.4-1.3-3.3.1-.3.6-1.6-.1-3.3 0 0-1.1-.3-3.5 1.3a12 12 0 0 0-6.3 0C6.6 2.9 5.5 3.2 5.5 3.2c-.7 1.7-.2 3-.1 3.3-.8.9-1.3 2-1.3 3.3 0 4.8 2.9 5.9 5.7 6.2-.5.5-.6 1.1-.6 2.1V22"/><path d="M9.2 19c-2.8.9-2.8-1.5-4-2"/>',
  );
}
