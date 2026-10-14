// Copyright (c) Meta Platforms, Inc. and affiliates.

import {afterEach, describe, expect, it, vi} from 'vitest';

// A computed specifier, because the worker is a plain script in public/: it is
// outside the TypeScript program and exports nothing, so importing it is the
// only way to run it. Each test re-imports it after `vi.resetModules()`, since
// everything under test happens at module scope.
const WORKER_MODULE = new URL('../public/cross-origin-isolation-sw.js', import.meta.url).href;

const RELOAD_KEY = 'openzl-coi-reloaded';
const SCRIPT_URL = 'https://openzl.org/tools/playground/cross-origin-isolation-sw.js';

function fakeSessionStorage(initial: Record<string, string> = {}) {
  const entries = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
    removeItem: (key: string) => entries.delete(key),
    has: (key: string) => entries.has(key),
  };
}

/** A worker partway through installing, whose state the test moves along. */
function fakeIncomingWorker() {
  const listeners: (() => void)[] = [];
  const worker = {
    state: 'installing',
    addEventListener: (_type: string, handler: () => void) => listeners.push(handler),
    moveTo: (state: string) => {
      worker.state = state;
      listeners.forEach((handler) => handler());
    },
  };
  return worker;
}

interface FakeRegistration {
  active: object | null;
  installing?: ReturnType<typeof fakeIncomingWorker> | null;
  waiting?: object | null;
}

/** Whether `promise` has resolved by the time pending microtasks have run. */
async function hasSettled(promise: Promise<void> | undefined) {
  let settled = false;
  void promise?.then(() => {
    settled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return settled;
}

interface PageOptions {
  crossOriginIsolated?: boolean;
  reloaded?: boolean;
  /** Site data blocked: reading `sessionStorage` at all throws, as in Chrome. */
  storageBlocked?: boolean;
  /** Reads work but writing the reload guard throws. */
  storageWriteFails?: boolean;
  /** `null` for a module script, `''` for an inline one. */
  currentScript?: {src: string} | null;
  /** Omitted entirely for a browser without service worker support. */
  serviceWorker?: {
    controller?: object | null;
    /** A thunk, so a rejection is created under the module's `catch`, not before it. */
    registration?: () => Promise<FakeRegistration>;
  };
}

/** Runs the script the way the page does, with everything it touches faked. */
async function loadAsPage({
  crossOriginIsolated = false,
  reloaded = false,
  storageBlocked = false,
  storageWriteFails = false,
  currentScript = {src: SCRIPT_URL},
  serviceWorker,
}: PageOptions) {
  const storage = fakeSessionStorage(reloaded ? {[RELOAD_KEY]: '1'} : {});
  if (storageWriteFails) {
    storage.setItem = () => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    };
  }
  const reload = vi.fn();
  const listeners = new Map<string, () => void>();
  const register = vi.fn(
    () =>
      serviceWorker?.registration?.() ??
      Promise.resolve<FakeRegistration>({active: null, installing: fakeIncomingWorker(), waiting: null}),
  );
  const page: {openzlIsolationSettled?: Promise<void>} = {};

  const win = Object.assign(page, {crossOriginIsolated, location: {reload}});
  Object.defineProperty(win, 'sessionStorage', {
    get: () => {
      if (storageBlocked) {
        throw new DOMException('Access is denied for this document.', 'SecurityError');
      }
      return storage;
    },
  });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', {currentScript});
  vi.stubGlobal('navigator', {
    ...(serviceWorker === undefined
      ? {}
      : {
          serviceWorker: {
            controller: serviceWorker.controller ?? null,
            addEventListener: (type: string, handler: () => void) => listeners.set(type, handler),
            register,
          },
        }),
  });
  const error = vi.spyOn(console, 'error').mockReturnValue(undefined);

  vi.resetModules();
  await import(/* @vite-ignore */ WORKER_MODULE);
  // `register().then(...)` settles a microtask after the module body, so give
  // it one before asserting on what the page did.
  await Promise.resolve();
  await Promise.resolve();

  return {
    storage,
    reload,
    register,
    error,
    settled: page.openzlIsolationSettled,
    fireControllerChange: () => listeners.get('controllerchange')?.(),
  };
}

/**
 * Runs the script the way the browser runs a service worker. The two lifecycle
 * mocks come back rather than being read off `self`, which TypeScript types as
 * a `Window` here and which has neither of them.
 */
async function loadAsWorker() {
  const handlers = new Map<string, (event: unknown) => void>();
  const skipWaiting = vi.fn();
  const claim = vi.fn();
  vi.stubGlobal('self', {
    addEventListener: (type: string, handler: (event: unknown) => void) => handlers.set(type, handler),
    skipWaiting,
    clients: {claim},
  });

  vi.resetModules();
  await import(/* @vite-ignore */ WORKER_MODULE);
  return {handlers, skipWaiting, claim};
}

/** Drives the fetch handler and returns whatever it responded with. */
async function respondTo(handlers: Map<string, (event: unknown) => void>, request: object) {
  let responded: Promise<Response> | undefined;
  handlers.get('fetch')?.({request, respondWith: (value: Promise<Response>) => (responded = value)});
  return responded === undefined ? undefined : await responded;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('as a page', () => {
  it('clears the reload guard and registers nothing once isolated', async () => {
    const {storage, register, reload} = await loadAsPage({
      crossOriginIsolated: true,
      reloaded: true,
      serviceWorker: {},
    });

    expect(storage.has(RELOAD_KEY)).toBe(false);
    expect(register).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it.each([
    ['a module script, which has no currentScript', null],
    ['an inline script, whose src is empty', {src: ''}],
  ])('reports rather than throwing when loaded as %s', async (_case, currentScript) => {
    // Reading `.src` off a null currentScript threw a TypeError here, ahead of
    // every console.error below it, so the page lost SharedArrayBuffer with
    // nothing but a raw exception to go on.
    const {register, reload, error} = await loadAsPage({
      currentScript,
      serviceWorker: {},
    });

    expect(register).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('classic external script'));
  });

  it('reports a browser without service workers instead of reloading', async () => {
    const {error, reload} = await loadAsPage({});

    expect(error).toHaveBeenCalledWith(expect.stringContaining('no service worker support'));
    expect(reload).not.toHaveBeenCalled();
  });

  it('reports failure rather than looping when the one reload did not isolate', async () => {
    const {error, register, reload} = await loadAsPage({reloaded: true, serviceWorker: {}});

    expect(error).toHaveBeenCalledWith(expect.stringContaining('cross-origin isolation failed'));
    expect(register).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads when a freshly installed worker takes control', async () => {
    const {register, reload, storage, fireControllerChange} = await loadAsPage({serviceWorker: {}});

    expect(register).toHaveBeenCalledWith(SCRIPT_URL);
    // Nothing controls the document yet, so the page waits rather than reloading.
    expect(reload).not.toHaveBeenCalled();

    fireControllerChange();
    expect(reload).toHaveBeenCalledOnce();
    expect(storage.getItem(RELOAD_KEY)).toBe('1');
  });

  it('reloads when a worker is already active and controlling, which fires no event', async () => {
    // The silent case: `controllerchange` never comes, so without the check on
    // the registration the page would sit there unisolated forever.
    const {reload} = await loadAsPage({
      serviceWorker: {
        controller: {},
        registration: () => Promise.resolve({active: {}, installing: null, waiting: null}),
      },
    });

    expect(reload).toHaveBeenCalledOnce();
  });

  it('reloads when a worker is active but not controlling, as after a hard reload', async () => {
    // A hard reload bypasses the worker for that load, and an already active
    // worker fires no `controllerchange`, so this too would sit unisolated.
    const {reload} = await loadAsPage({
      serviceWorker: {controller: null, registration: () => Promise.resolve({active: {}})},
    });

    expect(reload).toHaveBeenCalledOnce();
  });

  it('reloads once when the registration and the event both ask for it', async () => {
    const {reload, fireControllerChange} = await loadAsPage({
      serviceWorker: {
        controller: {},
        registration: () => Promise.resolve({active: {}, installing: null, waiting: null}),
      },
    });

    fireControllerChange();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('reports a registration that fails', async () => {
    const {error, reload} = await loadAsPage({
      serviceWorker: {registration: () => Promise.reject(new Error('denied'))},
    });

    expect(error).toHaveBeenCalledWith(expect.stringContaining('registering'), expect.any(Error));
    expect(reload).not.toHaveBeenCalled();
  });
});

/**
 * The app holds back its missing-threads screen until this settles, so it has
 * to settle on every path that leaves the page unisolated, and on none that
 * reloads it. A path that never settles leaves the page blank.
 */
describe('the settled signal', () => {
  it.each<[string, PageOptions]>([
    ['the page is already isolated', {crossOriginIsolated: true, serviceWorker: {}}],
    ['the script cannot find its own URL', {currentScript: null, serviceWorker: {}}],
    ['there are no service workers', {}],
    ['the one reload has been spent', {reloaded: true, serviceWorker: {}}],
    ['registration fails', {serviceWorker: {registration: () => Promise.reject(new Error('denied'))}}],
  ])('settles when %s', async (_case, options) => {
    const {settled, reload} = await loadAsPage(options);

    expect(reload).not.toHaveBeenCalled();
    expect(await hasSettled(settled)).toBe(true);
  });

  it('stays pending while a new worker installs, and settles if it fails to', async () => {
    const installing = fakeIncomingWorker();
    const {settled} = await loadAsPage({
      serviceWorker: {registration: () => Promise.resolve({active: null, installing, waiting: null})},
    });

    expect(await hasSettled(settled)).toBe(false);

    installing.moveTo('redundant');
    expect(await hasSettled(settled)).toBe(true);
  });

  it('settles when a new worker activates without taking control', async () => {
    const installing = fakeIncomingWorker();
    const {settled, reload} = await loadAsPage({
      serviceWorker: {registration: () => Promise.resolve({active: null, installing, waiting: null})},
    });

    installing.moveTo('activated');
    expect(reload).not.toHaveBeenCalled();
    expect(await hasSettled(settled)).toBe(true);
  });

  it('stays pending when a new worker takes control and then activates', async () => {
    const installing = fakeIncomingWorker();
    const {settled, reload, fireControllerChange} = await loadAsPage({
      serviceWorker: {registration: () => Promise.resolve({active: null, installing, waiting: null})},
    });

    fireControllerChange();
    installing.moveTo('activated');
    expect(reload).toHaveBeenCalledOnce();
    expect(await hasSettled(settled)).toBe(false);
  });

  it('settles rather than hangs when site data is blocked', async () => {
    // Reading `sessionStorage` throws here, while service workers still exist.
    const {settled, reload, register, error} = await loadAsPage({storageBlocked: true, serviceWorker: {}});

    expect(register).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
    expect(await hasSettled(settled)).toBe(true);
  });

  it('settles rather than hangs when the reload guard cannot be written', async () => {
    const {settled, reload, fireControllerChange} = await loadAsPage({storageWriteFails: true, serviceWorker: {}});

    // From the event, outside the code that decided to register.
    fireControllerChange();
    expect(reload).not.toHaveBeenCalled();
    expect(await hasSettled(settled)).toBe(true);
  });

  it('stays pending when the page is about to reload', async () => {
    const {settled, reload} = await loadAsPage({
      serviceWorker: {
        controller: {},
        registration: () => Promise.resolve({active: {}, installing: null, waiting: null}),
      },
    });

    expect(reload).toHaveBeenCalledOnce();
    expect(await hasSettled(settled)).toBe(false);
  });
});

describe('as a worker', () => {
  it('holds the install event open until it has skipped waiting', async () => {
    // `skipWaiting` is a promise; without `waitUntil` the worker can be killed
    // before it settles and the page waits for a controller that never comes.
    const {handlers, skipWaiting} = await loadAsWorker();
    const waitUntil = vi.fn();
    const skipped = Symbol('skipWaiting');
    skipWaiting.mockReturnValue(skipped);

    handlers.get('install')?.({waitUntil});

    expect(waitUntil).toHaveBeenCalledWith(skipped);
  });

  it('holds the activate event open until it has claimed the page', async () => {
    const {handlers, claim} = await loadAsWorker();
    const waitUntil = vi.fn();
    const claimed = Symbol('claim');
    claim.mockReturnValue(claimed);

    handlers.get('activate')?.({waitUntil});

    expect(waitUntil).toHaveBeenCalledWith(claimed);
  });

  it('adds both isolation headers to an ordinary response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('payload', {status: 200}))),
    );
    const {handlers} = await loadAsWorker();

    const response = await respondTo(handlers, {cache: 'default', mode: 'cors'});

    expect(response?.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(response?.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
    expect(await response?.text()).toBe('payload');
  });

  it.each([0, 204, 205, 304])('passes a %i response through untouched', async (status) => {
    // Rebuilding these throws: an opaque response has an immutable header list,
    // and the null-body statuses may not be given a body at all.
    const original = {status, statusText: '', headers: new Headers(), body: null};
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(original)),
    );
    const {handlers} = await loadAsWorker();

    expect(await respondTo(handlers, {cache: 'default', mode: 'cors'})).toBe(original);
  });

  it('leaves a cross-origin only-if-cached request to the browser', async () => {
    // Chrome rejects these outright once a worker touches them.
    vi.stubGlobal('fetch', vi.fn());
    const {handlers} = await loadAsWorker();

    expect(await respondTo(handlers, {cache: 'only-if-cached', mode: 'no-cors'})).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
});
