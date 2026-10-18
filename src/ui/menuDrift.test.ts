import { describe, expect, it } from 'vitest';
import { GROUPS } from './hud';
import { PANELS } from './panels/index';
import { SHORTCUTS } from './shortcuts';

/** Menu entries that deliberately have no keyboard shortcut. */
const NO_SHORTCUT = new Set<string>([]);
/** Panels opened from the map (clicking a building, city or vehicle), not from a menu or key. */
const MAP_ONLY = new Set(['building', 'city', 'vehicle']);

const menuPanels = GROUPS.flatMap((g) => g.items.map((i) => i.panel));
const shortcutPanels = SHORTCUTS.flatMap((s) => (s.action.kind === 'panel' ? [s.action.id] : []));

describe('top-bar menus, PANELS and SHORTCUTS stay consistent', () => {
  it('no menu entry names a missing panel', () => {
    for (const p of menuPanels) expect(PANELS[p], `menu entry ${p}`).toBeDefined();
  });

  it('no shortcut names a missing panel', () => {
    for (const p of shortcutPanels) expect(PANELS[p], `shortcut ${p}`).toBeDefined();
  });

  it('every menu panel has a shortcut or an explicit exemption', () => {
    for (const p of menuPanels) expect(shortcutPanels.includes(p) || NO_SHORTCUT.has(p), `${p} has no shortcut`).toBe(true);
  });

  it('every registered panel is in a menu or explicitly map-only', () => {
    for (const id of Object.keys(PANELS)) expect(menuPanels.includes(id) || MAP_ONLY.has(id), `${id} is unreachable`).toBe(true);
  });

  it('menu entries are unique', () => {
    expect(new Set(menuPanels).size).toBe(menuPanels.length);
  });
});
