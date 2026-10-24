/**
 * Save format versions. A leaf module (no imports), so state.ts and migrations.ts can both depend
 * on it without a cycle: migrations.ts → state.ts → version.ts.
 */
export const SAVE_VERSION = 8;
/** Oldest version that can still be loaded; SMOKESTACK I saves (version 1) are refused. */
export const MIN_SAVE_VERSION = 2;
