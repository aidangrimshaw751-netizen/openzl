// Copyright (c) Meta Platforms, Inc. and affiliates.

import {describe, it, expect, afterEach, vi} from 'vitest';
import {detectEngineSupport, engineBlocker, isolationSettled} from '../src/engineSupport.ts';

/**
 * The Node runtime this suite runs under supports Memory64, so the real engine
 * validates the wasm64 module and the unsupported path is unreachable without a
 * stand-in.
 */
function fakeWebAssembly(acceptsMemory64: boolean) {
  return {validate: () => acceptsMemory64};
}

describe('the probe itself', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports this engine honestly', () => {
    // The Node runtime this suite runs under ships Memory64, so the stand-in
    // below starts from an engine that accepts the probe.
    expect(detectEngineSupport().memory64).toBe(true);
  });

  it('asks about the 64-bit memory flag', () => {
    // An engine without Memory64: it decodes every module this one does, except
    // a memory whose limits flags (byte 11) carry the 64-bit bit. A probe that
    // asked anything else, a wasm32 module say, would still read as support.
    const real = WebAssembly.validate.bind(WebAssembly);
    vi.stubGlobal('WebAssembly', {validate: (bytes: Uint8Array) => real(bytes) && (bytes[11] & 0x04) === 0});
    expect(detectEngineSupport().memory64).toBe(false);
  });
});

describe('detectEngineSupport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports memory64 when the engine accepts a 64-bit memory', () => {
    vi.stubGlobal('WebAssembly', fakeWebAssembly(true));
    expect(detectEngineSupport().memory64).toBe(true);
  });

  it('reports no memory64 when the engine rejects the module', () => {
    // Safari's failure mode: WebAssembly is present, Memory64 is not.
    vi.stubGlobal('WebAssembly', fakeWebAssembly(false));
    expect(detectEngineSupport()).toMatchObject({wasm: true, memory64: false});
  });

  it('does not probe memory64 when WebAssembly is missing entirely', () => {
    // The probe would throw reading `validate` off undefined.
    vi.stubGlobal('WebAssembly', undefined);
    expect(detectEngineSupport()).toMatchObject({wasm: false, memory64: false});
  });

  it('requires both SharedArrayBuffer and cross-origin isolation for threads', () => {
    vi.stubGlobal('WebAssembly', fakeWebAssembly(true));

    vi.stubGlobal('SharedArrayBuffer', undefined);
    vi.stubGlobal('crossOriginIsolated', true);
    expect(detectEngineSupport().threads).toBe(false);

    // The case the second half of the guard exists for: the constructor is
    // exposed, but the document is not isolated.
    vi.stubGlobal('SharedArrayBuffer', ArrayBuffer);
    vi.stubGlobal('crossOriginIsolated', false);
    expect(detectEngineSupport().threads).toBe(false);

    vi.stubGlobal('SharedArrayBuffer', ArrayBuffer);
    vi.stubGlobal('crossOriginIsolated', true);
    expect(detectEngineSupport().threads).toBe(true);
  });

  it('blocks loading when the page is not cross-origin isolated', () => {
    // The module spawns its thread pool at startup, so a page served without
    // COOP/COEP cannot load it even to compress.
    vi.stubGlobal('WebAssembly', fakeWebAssembly(true));
    vi.stubGlobal('SharedArrayBuffer', ArrayBuffer);
    vi.stubGlobal('crossOriginIsolated', false);
    expect(engineBlocker(detectEngineSupport())).toBe('no-threads');
  });
});

describe('engineBlocker', () => {
  it('reports the missing 64-bit memory', () => {
    expect(engineBlocker({wasm: true, memory64: false, threads: true})).toBe('no-memory64');
  });

  it('prefers the absent runtime over the absent feature', () => {
    expect(engineBlocker({wasm: false, memory64: false, threads: false})).toBe('no-wasm');
  });

  it('prefers the missing 64-bit memory over missing threads', () => {
    expect(engineBlocker({wasm: true, memory64: false, threads: false})).toBe('no-memory64');
  });

  it('reports missing threads', () => {
    expect(engineBlocker({wasm: true, memory64: true, threads: false})).toBe('no-threads');
  });

  it('reports nothing when the module can load', () => {
    expect(engineBlocker({wasm: true, memory64: true, threads: true})).toBeNull();
  });
});

describe('isolationSettled', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hands back what the isolation worker published', () => {
    const published = new Promise<void>(() => undefined);
    vi.stubGlobal('openzlIsolationSettled', published);
    expect(isolationSettled()).toBe(published);
  });

  it('is already resolved when the worker script is not on the page', async () => {
    // Otherwise a page without the script, the test suite included, would wait
    // forever before reporting missing threads.
    vi.stubGlobal('openzlIsolationSettled', undefined);
    await expect(isolationSettled()).resolves.toBeUndefined();
  });
});
