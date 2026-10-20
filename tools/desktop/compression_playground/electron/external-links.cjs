// Copyright (c) Meta Platforms, Inc. and affiliates.

/* eslint-disable @typescript-eslint/no-require-imports */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ALLOWED_HOSTS = new Set(['openzl.org']);

/** Whether a link from the UI may be opened in the system browser. */
function isAllowedExternalUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === 'https:' &&
    ALLOWED_HOSTS.has(parsed.hostname) &&
    parsed.port === '' &&
    parsed.username === '' &&
    parsed.password === ''
  );
}

/**
 * Whether the system can open a link in a browser. On Linux Electron opens
 * links by running xdg-open, and reports success even when there is none (WSL
 * and minimal installs often lack it), so it is looked for on PATH first.
 * Elsewhere the OS handles it.
 */
function canOpenExternally({platform = process.platform, env = process.env} = {}) {
  if (platform !== 'linux') {
    return true;
  }
  return (env.PATH ?? '').split(path.delimiter).some((directory) => {
    if (directory === '') {
      return false;
    }
    try {
      fs.accessSync(path.join(directory, 'xdg-open'), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

module.exports = {canOpenExternally, isAllowedExternalUrl};
