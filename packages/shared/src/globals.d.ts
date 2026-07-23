/**
 * The runtime globals this package relies on, declared rather than imported.
 *
 * `packages/shared` targets three runtimes — the browser bundle, Deno in the
 * Edge Functions, and Node in the scripts and tests — and its `lib` is
 * deliberately ES2022 with no DOM. Adding DOM would put `window`, `document`
 * and `localStorage` in scope for code that also runs server-side, which is a
 * larger hole than the one being plugged.
 *
 * Everything below is WinterCG: present in all three. Declaring exactly what
 * is used is narrower than the lib that would supply it, and the list is short
 * enough to read.
 */

declare function fetch(input: string, init?: RequestInitLike): Promise<ResponseLike>;

type RequestInitLike = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: unknown;
};

type ResponseLike = {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
};

declare const console: {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
};

declare const crypto: {
  randomUUID(): string;
  subtle: {
    digest(algorithm: string, data: ArrayBufferView): Promise<ArrayBuffer>;
    importKey(
      format: string,
      keyData: ArrayBufferView,
      algorithm: { name: string; hash: string },
      extractable: boolean,
      usages: string[],
    ): Promise<unknown>;
    sign(algorithm: string, key: unknown, data: ArrayBufferView): Promise<ArrayBuffer>;
  };
};

declare const TextEncoder: { new (): { encode(input: string): Uint8Array } };

declare const AbortSignal: { timeout(ms: number): unknown };
