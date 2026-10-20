// Copyright (c) Meta Platforms, Inc. and affiliates.

export function isAllowedExternalUrl(url: string): boolean;

/** Whether links can be opened in a browser: false on Linux without xdg-open. */
export function canOpenExternally(options?: {platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv}): boolean;
