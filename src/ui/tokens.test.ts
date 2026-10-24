import { describe, expect, it } from 'vitest';

/* The project has no node typings, hence the untyped dynamic import (see sidePanel.test.ts). */
const FS = 'node:fs';
const fs = (await import(/* @vite-ignore */ FS)) as {
  readFileSync(p: string, enc: string): string;
};
const { readFileSync } = fs;
const cwd = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();

const css = readFileSync(`${cwd}/src/ui/theme.css`, 'utf8');
const rootBlock = /:root\s*{([^}]*)}/.exec(css)?.[1] ?? '';

function token(name: string): string | undefined {
  const m = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(rootBlock);
  return m?.[1].trim();
}

const EXACT: Record<string, string> = {
  '--font-display': "'Playfair Display', Georgia, serif",
  '--font-ui': "'Source Sans 3', 'Segoe UI', system-ui, sans-serif",
  '--font-body': 'var(--font-ui)',
  '--fs-xs': '11px',
  '--fs-sm': '12.5px',
  '--fs-md': '14px',
  '--fs-lg': '18px',
  '--fs-xl': '26px',
  '--lh-tight': '1.2',
  '--lh-body': '1.45',
  '--sp-1': '4px',
  '--sp-2': '8px',
  '--sp-3': '12px',
  '--sp-4': '16px',
  '--sp-5': '24px',
  '--sp-6': '32px',
  '--r-sm': '3px',
  '--r-md': '6px',
  '--surface-0': '#1f150f',
  '--surface-1': '#2b1d14',
  '--surface-2': '#37261b',
  '--surface-3': '#45301f',
  '--paper': '#f3e9d2',
  '--paper-ink': '#1d1a16',
  '--text': '#f1e6cf',
  '--text-muted': '#c3b394',
  '--text-faint': '#9a8a6c',
  '--accent': '#d4ab3a',
  '--accent-strong': '#e8c75a',
  '--accent-quiet': 'rgba(212,171,58,0.35)',
  '--positive': '#7cc47c',
  '--negative': '#ef7d6d',
  '--warning': '#f0b44c',
  '--info': '#6cc2c9',
  '--shadow-1': '0 1px 2px rgba(0,0,0,.4)',
  '--shadow-2': '0 8px 24px rgba(0,0,0,.5)',
  '--focus': '0 0 0 2px var(--accent-strong)',
  '--walnut': 'var(--surface-1)',
  '--walnut-light': 'var(--surface-2)',
  '--brass': 'var(--accent)',
  '--brass-light': 'var(--accent-strong)',
  '--brass-dark': '#8a6d17',
  '--good': 'var(--positive)',
  '--bad': 'var(--negative)',
};

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('design tokens', () => {
  for (const [name, value] of Object.entries(EXACT)) {
    it(`${name} is ${value}`, () => {
      expect(token(name)).toBe(value);
    });
  }

  it('each tone has a 16% alpha -bg tint', () => {
    for (const tone of ['positive', 'negative', 'warning', 'info']) {
      expect(token(`--${tone}-bg`)).toMatch(/^rgba\(\d+,\s*\d+,\s*\d+,\s*0?\.16\)$/);
    }
  });

  it('keeps --player and --rival', () => {
    expect(token('--player')).toBe('#2f6fb5');
    expect(token('--rival')).toBe('#b5302f');
  });

  describe('contrast (WCAG AA)', () => {
    for (const t of ['--text', '--text-muted', '--positive', '--negative', '--warning', '--info', '--accent']) {
      for (const s of ['--surface-1', '--surface-2']) {
        it(`${t} on ${s} >= 4.5`, () => {
          expect(contrast(token(t)!, token(s)!)).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
    // dark text on a solid tone fill (a confirm button, a toned badge) stays legible
    for (const b of ['--positive', '--negative', '--warning']) {
      it(`--surface-0 on ${b} >= 4.5 (inspector badge)`, () => {
        expect(contrast(token('--surface-0')!, token(b)!)).toBeGreaterThanOrEqual(4.5);
      });
    }
    it('--text on --surface-1 >= 4.5 (owner badges)', () => {
      expect(contrast(token('--text')!, token('--surface-1')!)).toBeGreaterThanOrEqual(4.5);
    });
    // the newspaper's inks on its paper (both the light and the shaded end of the sheet)
    for (const t of ['--news-ink', '--news-ink-soft', '--news-ink-faint', '--news-civic']) {
      for (const s of ['--news-paper', '--news-paper-shade']) {
        it(`${t} on ${s} >= 4.5 (newsprint)`, () => {
          expect(contrast(token(t)!, token(s)!)).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
    it('--paper-ink on --paper >= 7', () => {
      expect(contrast(token('--paper-ink')!, token('--paper')!)).toBeGreaterThanOrEqual(7);
    });
  });
});
