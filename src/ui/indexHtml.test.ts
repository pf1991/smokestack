import { describe, expect, it } from 'vitest';

import html from '../../index.html?raw';

describe('index.html', () => {
  it('opts into safe-area / PWA-ish mobile chrome', () => {
    expect(html).toMatch(/viewport-fit=cover/);
    expect(html).toMatch(/apple-mobile-web-app-capable/);
    expect(html).toMatch(/overscroll-behavior:\s*none/);
  });

  it('the world canvas disables browser touch gestures (else a pen/touch drag is cancelled)', () => {
    expect(html).toMatch(/#world\s*\{[^}]*touch-action:\s*none/);
  });

  it('#ui stacks above the side panel (z 100) so top-bar dropdowns are not covered', () => {
    const m = html.match(/#ui\s*\{[^}]*z-index:\s*(\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(100);
    expect(Number(m![1])).toBeLessThan(4000);
  });
});
