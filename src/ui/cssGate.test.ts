import { describe, expect, it } from 'vitest';

/* The project has no node typings, hence the untyped dynamic import (see sidePanel.test.ts). */
const FS = 'node:fs';
const fs = (await import(/* @vite-ignore */ FS)) as {
  readFileSync(p: string, enc: string): string;
  existsSync(p: string): boolean;
};
const { readFileSync, existsSync } = fs;
const cwd = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();

/**
 * CSS files already moved onto the design tokens. Each rework task appends its files here.
 * Deliberately absent: src/ui/panels/newspaper-display.css, the newspaper's masthead, lead headline
 * and drop cap, the only type in the game drawn above the --fs-* scale (see that file's header).
 */
export const MIGRATED_CSS: string[] = ['src/ui/theme.css', 'src/ui/kit.css', 'src/ui/hud.css', 'src/ui/sidePanel.css', 'src/ui/panels/panels.css', 'src/ui/panels/finance.css', 'src/ui/panels/routes.css', 'src/ui/panels/managers.css', 'src/ui/panels/fleet.css', 'src/ui/panels/politics.css', 'src/ui/panels/contracts.css', 'src/ui/panels/goals.css', 'src/ui/panels/newspaper.css', 'src/ui/toolbar.css', 'src/ui/toasts.css', 'src/ui/cardModal.css', 'src/ui/menu.css', 'src/ui/coldOpen.css'];

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
  return out;
}

describe('css gate', () => {
  it('detects violations', () => {
    expect(gateViolations('a{font-size:13px;color:#fff;font-family:Georgia}')).toHaveLength(3);
    expect(gateViolations(':root{--x:#fff} a{font-size:var(--fs-md);font-family:var(--font-ui)}')).toEqual([]);
    // --fs-hero (64px) is the one size above the scale, for the main menu's title
    expect(gateViolations('h1{font-size:var(--fs-hero)}')).toEqual([]);
    expect(gateViolations('h1{font-size:var(--fs-huge)}')).toHaveLength(1);
  });

  for (const file of MIGRATED_CSS) {
    it(`${file} uses only tokens`, () => {
      if (!existsSync(`${cwd}/${file}`)) return; // not written yet
      expect(gateViolations(readFileSync(`${cwd}/${file}`, 'utf8'))).toEqual([]);
    });
  }
});
