import assert from "node:assert/strict";
import test from "node:test";
import { RapidRaterApp } from "../src/app/rapid-rater-app.js";

test("the anonymous landing has a stable login URL", () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  let destination = "";
  globalThis.document = {
    body: { classList: { remove() {} } },
    title: ""
  };
  globalThis.window = {
    location: { pathname: "/tv/wishlist" },
    history: { replaceState(_state, _title, path) { destination = path; } },
    setTimeout() {}
  };
  try {
    const app = Object.create(RapidRaterApp.prototype);
    app.Elements = {
      authLanding: { hidden: true },
      signOut: { hidden: false },
      showSignup: { hidden: false },
      loginEmail: { focus() {} }
    };
    app.ShowAuthPanel = (panel) => assert.equal(panel, "login");

    app.ShowAuthLanding(false);

    assert.equal(destination, "/login");
    assert.equal(app.Elements.authLanding.hidden, false);
    assert.equal(app.Elements.signOut.hidden, true);
    assert.equal(app.Elements.showSignup.hidden, true);
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test("sign out closes the live queue and navigates to login", async () => {
  const originalWindow = globalThis.window;
  let closed = false;
  let destination = "";
  let clearedTimeout = 0;
  let clearedInterval = 0;
  globalThis.window = {
    clearTimeout(id) { clearedTimeout = id; },
    clearInterval(id) { clearedInterval = id; },
    location: {
      replace(path) { destination = path; }
    }
  };
  try {
    const app = Object.create(RapidRaterApp.prototype);
    app.Elements = { signOut: { disabled: false } };
    app.SyncTimer = 12;
    app.AccountRefreshTimer = 34;
    app.RaterEvents = { close() { closed = true; } };
    app.FlushStateSync = async () => { throw new Error("Sign out must not wait for state sync"); };
    app.RequestJson = async (url, method) => {
      assert.equal(url, "/api/auth/logout");
      assert.equal(method, "POST");
      return { ok: true };
    };

    await app.SignOut();

    assert.equal(closed, true);
    assert.equal(destination, "/login");
    assert.equal(clearedTimeout, 12);
    assert.equal(clearedInterval, 34);
    assert.equal(app.Elements.signOut.disabled, true);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("a failed sign out re-enables the control", async () => {
  const originalWindow = globalThis.window;
  globalThis.window = { clearTimeout() {}, clearInterval() {} };
  try {
    const app = Object.create(RapidRaterApp.prototype);
    app.Elements = { signOut: { disabled: false } };
    app.RequestJson = async () => { throw new Error("Logout failed"); };

    await assert.rejects(() => app.SignOut(), /Logout failed/);

    assert.equal(app.Elements.signOut.disabled, false);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("an expired session still completes local sign out navigation", async () => {
  const originalWindow = globalThis.window;
  let destination = "";
  globalThis.window = {
    clearTimeout() {},
    clearInterval() {},
    location: { replace(path) { destination = path; } }
  };
  try {
    const app = Object.create(RapidRaterApp.prototype);
    app.Elements = { signOut: { disabled: false } };
    app.RequestJson = async () => { throw Object.assign(new Error("Sign in to continue."), { status: 401 }); };

    await app.SignOut();

    assert.equal(destination, "/login");
  } finally {
    globalThis.window = originalWindow;
  }
});
