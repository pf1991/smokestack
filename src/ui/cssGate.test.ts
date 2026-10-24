import { describe, expect, it } from 'vitest';

/* The project has no node typings, hence the untyped dynamic import (see sidePanel.test.ts). */
const FS = 'node:fs';
const fs = (await import(/* @vite-ignore */ FS)) as {
  readFileSync(p: string, enc: string): string;
  readdirSync(p: string, opts: { recursive: true }): string[];
};
const { readFileSync, readdirSync } = fs;
const cwd = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();

/**
 * Every CSS file under src/ui is on the design tokens, with one documented exemption:
 * src/ui/panels/newspaper-display.css, the newspaper's masthead, lead headline and drop cap, the only
 * type in the game drawn above the --fs-* scale (see that file's header).
 */
export const GATE_EXEMPT: string[] = ['src/ui/panels/newspaper-display.css'];
export const MIGRATED_CSS: string[] = readdirSync(`${cwd}/src/ui`, { recursive: true })
  .map((f) => `src/ui/${f.replace(/\\/g, '/')}`)
  .filter((f) => f.endsWith('.css') && !GATE_EXEMPT.includes(f))
  .sort();

/** Strip comments and custom-property declarations (tokens are where raw values live). */
function stripped(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[\w-]+\s*:[^;}]*;?/g, '');
}

export function gateViolations(css: string): string[] {
  const out: string[] = [];
  const src = stripped(css);
  for (const m of src.matchAll(/(?<![\w-])font-size\s*:\s*([^;}]+)/g)) {
    const v = m[1].trim();
    if (v !== 'inherit' && !/^var\(--fs-(xs|sm|md|lg|xl|hero)\)$/.test(v)) out.push(`font-size: ${v}`);
  }
  for (const m of src.matchAll(/(?<![\w-])font-family\s*:\s*([^;}]+)/g)) {
    const v = m[1].trim();
    if (!/^var\(--font-[\w-]+\)$/.test(v)) out.push(`font-family: ${v}`);
  }
  for (const m of src.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) out.push(`hex ${m[0]}`);
  // --focus is a box-shadow value: as an outline it computes to none and hides the focus ring
  for (const m of src.matchAll(/(?<![\w-])outline(?:-[\w-]+)?\s*:\s*([^;}]*var\(--focus\)[^;}]*)/g)) out.push(`outline: ${m[1].trim()}`);
  return out;
}

describe('css gate', () => {
  it('detects violations', () => {
    expect(gateViolations('a{font-size:13px;color:#fff;font-family:Georgia}')).toHaveLength(3);
    expect(gateViolations(':root{--x:#fff} a{font-size:var(--fs-md);font-family:var(--font-ui)}')).toEqual([]);
    // --fs-hero (64px) is the one size above the scale, for the main menu's title
    expect(gateViolations('h1{font-size:var(--fs-hero)}')).toEqual([]);
    expect(gateViolations('h1{font-size:var(--fs-huge)}')).toHaveLength(1);
    expect(gateViolations('a:focus-visible{outline:2px solid var(--focus)}')).toEqual(['outline: 2px solid var(--focus)']);
    expect(gateViolations('a:focus-visible{outline:none;box-shadow:var(--focus)}')).toEqual([]);
  });

  it('covers every UI stylesheet but the one exemption', () => {
    expect(MIGRATED_CSS).toContain('src/ui/theme.css');
    expect(MIGRATED_CSS).toContain('src/ui/panels/codex.css');
    expect(MIGRATED_CSS).toContain('src/ui/help.css');
    expect(MIGRATED_CSS).toContain('src/ui/tutorial.css');
    expect(MIGRATED_CSS).toContain('src/ui/photoMode.css');
    expect(MIGRATED_CSS).not.toContain('src/ui/panels/newspaper-display.css');
    expect(MIGRATED_CSS.length).toBeGreaterThanOrEqual(23);
  });

  for (const file of MIGRATED_CSS) {
    it(`${file} uses only tokens`, () => {
      expect(gateViolations(readFileSync(`${cwd}/${file}`, 'utf8'))).toEqual([]);
    });
  }
});
