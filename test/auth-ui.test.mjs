import assert from "node:assert/strict";
import test from "node:test";
import { RapidRaterApp } from "../src/app/rapid-rater-app.js";
import { LoginPath } from "../src/app/view-routes.js";

const NoOp = () => undefined;

test("session restoration keeps the loading layer visible until account initialization finishes", VerifySessionRestorationLoading);
test("the anonymous landing has a stable login URL", VerifyAnonymousLanding);
test("sign out closes the live queue and navigates to login", VerifySignOut);

async function VerifySessionRestorationLoading() {
  const originalDocument = globalThis.document;
  const completedClasses = [];
  const initialization = BuildInitializationGate();
  globalThis.document = { body: { classList: { add(value) { completedClasses.push(value); } } } };
  try {
    await AssertAuthenticatedSessionLoading(completedClasses, initialization);
  } finally {
    globalThis.document = originalDocument;
  }
}

async function AssertAuthenticatedSessionLoading(completedClasses, initialization) {
  const app = Object.create(RapidRaterApp.prototype);
  app.FetchJson = async () => ({ authenticated: true, csrfToken: "csrf", user: { email: "user@example.com" } });
  app.EnterAuthenticatedApp = NoOp;
  app.Initialize = () => initialization.promise;
  const session = app.BeginSession();
  await Promise.resolve();
  assert.deepEqual(completedClasses, []);
  initialization.Finish();
  await session;
  assert.deepEqual(completedClasses, ["startup-complete"]);
}

function BuildInitializationGate() {
  let finish;
  const promise = new Promise((resolve) => { finish = resolve; });
  return { promise, Finish: () => finish() };
}

function VerifyAnonymousLanding() {
  const original = CaptureBrowserGlobals();
  const navigation = { destination: "" };
  InstallAnonymousBrowser(navigation);
  try {
    const app = BuildAnonymousApp();
    app.ShowAuthLanding(false);
    AssertAnonymousLanding(app, navigation.destination);
  } finally {
    RestoreBrowserGlobals(original);
  }
}

function CaptureBrowserGlobals() {
  return { document: globalThis.document, window: globalThis.window };
}

function RestoreBrowserGlobals(original) {
  globalThis.document = original.document;
  globalThis.window = original.window;
}

function InstallAnonymousBrowser(navigation) {
  globalThis.document = {
    body: { classList: { remove: NoOp } },
    title: ""
  };
  globalThis.window = {
    location: { pathname: "/tv/wishlist" },
    history: { replaceState(_state, _title, path) { navigation.destination = path; } },
    setTimeout: NoOp
  };
}

function BuildAnonymousApp() {
  const app = Object.create(RapidRaterApp.prototype);
  app.Elements = {
    authLanding: { hidden: true },
    signOut: { hidden: false },
    showSignup: { hidden: false },
    loginEmail: { focus: NoOp }
  };
  app.ShowAuthPanel = (panel) => assert.equal(panel, "login");
  return app;
}

function AssertAnonymousLanding(app, destination) {
  assert.equal(destination, LoginPath);
  assert.equal(app.Elements.authLanding.hidden, false);
  assert.equal(app.Elements.signOut.hidden, true);
  assert.equal(app.Elements.showSignup.hidden, true);
}

async function VerifySignOut() {
  const originalWindow = globalThis.window;
  const state = InstallSignOutBrowser();
  try {
    const app = BuildSignOutApp(state);
    await app.SignOut();
    AssertSignOut(app, state);
  } finally {
    globalThis.window = originalWindow;
  }
}

function InstallSignOutBrowser() {
  const state = { closed: false, destination: "", clearedTimeout: 0, clearedInterval: 0 };
  globalThis.window = {
    clearTimeout(id) { state.clearedTimeout = id; },
    clearInterval(id) { state.clearedInterval = id; },
    location: {
      replace(path) { state.destination = path; }
    }
  };
  return state;
}

function BuildSignOutApp(state) {
  const app = Object.create(RapidRaterApp.prototype);
  app.Elements = { signOut: { disabled: false } };
  app.SyncTimer = 12;
  app.AccountRefreshTimer = 34;
  app.RaterEvents = { close() { state.closed = true; } };
  app.FlushStateSync = async () => { throw new Error("Sign out must not wait for state sync"); };
  app.RequestJson = async (url, method) => {
    assert.equal(url, "/api/auth/logout");
    assert.equal(method, "POST");
    return { ok: true };
  };
  return app;
}

function AssertSignOut(app, state) {
  assert.equal(state.closed, true);
  assert.equal(state.destination, LoginPath);
  assert.equal(state.clearedTimeout, 12);
  assert.equal(state.clearedInterval, 34);
  assert.equal(app.Elements.signOut.disabled, true);
}

test("a failed sign out re-enables the control", VerifyFailedSignOut);

async function VerifyFailedSignOut() {
  const originalWindow = globalThis.window;
  globalThis.window = { clearTimeout: NoOp, clearInterval: NoOp };
  try {
    const app = BuildFailedSignOutApp();
    await assert.rejects(() => app.SignOut(), /Logout failed/);
    assert.equal(app.Elements.signOut.disabled, false);
  } finally {
    globalThis.window = originalWindow;
  }
}

function BuildFailedSignOutApp() {
  const app = Object.create(RapidRaterApp.prototype);
  app.Elements = { signOut: { disabled: false } };
  app.RequestJson = async () => { throw new Error("Logout failed"); };
  return app;
}

test("an expired session still completes local sign out navigation", VerifyExpiredSignOut);

async function VerifyExpiredSignOut() {
  const originalWindow = globalThis.window;
  const state = { destination: "" };
  globalThis.window = BuildExpiredWindow(state);
  try {
    await BuildExpiredApp().SignOut();
    assert.equal(state.destination, LoginPath);
  } finally {
    globalThis.window = originalWindow;
  }
}

function BuildExpiredWindow(state) {
  return { clearTimeout: NoOp, clearInterval: NoOp, location: { replace: (path) => state.destination = path } };
}

function BuildExpiredApp() {
  const app = Object.create(RapidRaterApp.prototype);
  app.Elements = { signOut: { disabled: false } };
  app.RequestJson = async () => { throw Object.assign(new Error("Sign in to continue."), { status: 401 }); };
  return app;
}
