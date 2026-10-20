// Copyright (c) Meta Platforms, Inc. and affiliates.

import {chmodSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {delimiter, join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {canOpenExternally, isAllowedExternalUrl} from '../electron/external-links.cjs';

describe('isAllowedExternalUrl', () => {
  it('allows https links to openzl.org', () => {
    for (const url of [
      'https://openzl.org/',
      'https://openzl.org/getting-started/quick-start/',
      'https://openzl.org/api/c/compressor/#section',
    ]) {
      expect(isAllowedExternalUrl(url)).toBe(true);
    }
  });

  it('rejects other schemes, hosts, and look-alikes', () => {
    for (const url of [
      'http://openzl.org/',
      'https://example.com/',
      'https://openzl.org.example.com/',
      'https://www.openzl.org/',
      'https://evil.com/?next=https://openzl.org/',
      'https://user:pass@openzl.org/',
      'https://openzl.org:8443/',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'not a url',
      '',
    ]) {
      expect(isAllowedExternalUrl(url)).toBe(false);
    }
  });
});

describe('canOpenExternally', () => {
  it('needs xdg-open on PATH on Linux, which Electron would fail without and not say', () => {
    const directory = mkdtempSync(join(tmpdir(), 'xdg-open-test-'));
    try {
      expect(canOpenExternally({platform: 'linux', env: {PATH: ['/nonexistent', directory].join(delimiter)}})).toBe(
        false,
      );
      writeFileSync(join(directory, 'xdg-open'), '#!/bin/sh\n');
      chmodSync(join(directory, 'xdg-open'), 0o755);
      expect(canOpenExternally({platform: 'linux', env: {PATH: ['/nonexistent', directory].join(delimiter)}})).toBe(
        true,
      );
      expect(canOpenExternally({platform: 'linux', env: {}})).toBe(false);
    } finally {
      rmSync(directory, {recursive: true, force: true});
    }
  });

  it('leaves it to the OS elsewhere', () => {
    expect(canOpenExternally({platform: 'darwin', env: {}})).toBe(true);
    expect(canOpenExternally({platform: 'win32', env: {}})).toBe(true);
  });
});
