import type { RequestListener } from 'node:http';

export interface ProxyOptions {
  apiKey: string | undefined;
  upstream?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}
export function createProxy(opts: ProxyOptions): RequestListener;
