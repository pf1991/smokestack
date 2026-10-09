export type Result<T = void> = { ok: true; value: T } | { ok: false; error: string };

export function ok<T>(value: T): Result<T>;
export function ok(): Result<void>;
export function ok<T>(value?: T): Result<T> {
  return { ok: true, value: value as T };
}

export function err(error: string): Result<never> {
  return { ok: false, error };
}
