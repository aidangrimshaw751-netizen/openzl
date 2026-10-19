// Copyright (c) Meta Platforms, Inc. and affiliates.

export function unrepresentableCharacters(text: string, codePage: number): string[];
export function mayNotReachNativeToolsIntact(text: string, codePage: number | undefined): boolean;
export function assertReadableByNativeTools(text: string, what: string, fix: string, codePage: number): void;
export function parseCodePage(output: string): number | undefined;
export function windowsAnsiCodePage(): Promise<number | undefined>;
