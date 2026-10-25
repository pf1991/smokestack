import type { Speed } from '../sim/types';

export type ShortcutGroup = 'Time' | 'Panels' | 'Map' | 'Tools' | 'Help';

export interface Shortcut {
  /** display text: "F", "Space", "Esc", "Del", "?" */
  key: string;
  label: string;
  group: ShortcutGroup;
}

export type ShortcutAction =
  | { kind: 'speed'; speed: Speed }
  | { kind: 'panel'; id: string }
  | { kind: 'pause' }
  | { kind: 'toolbar' }
  | { kind: 'bulldoze' }
  | { kind: 'photo' }
  | { kind: 'help' }
  | { kind: 'escape' }
  | { kind: 'alerts' }
  | { kind: 'overlay'; id: 'pollution' | 'factions' };

export type ShortcutKind = ShortcutAction['kind'];

export const SHORTCUTS: readonly (Shortcut & { action: ShortcutAction })[] = [
  { key: 'Space', label: 'Pause or resume', group: 'Time', action: { kind: 'pause' } },
  { key: '1', label: 'Normal speed', group: 'Time', action: { kind: 'speed', speed: 1 } },
  { key: '2', label: 'Fast', group: 'Time', action: { kind: 'speed', speed: 2 } },
  { key: '3', label: 'Faster', group: 'Time', action: { kind: 'speed', speed: 4 } },
  { key: '4', label: 'Fastest', group: 'Time', action: { kind: 'speed', speed: 8 } },
  { key: 'R', label: 'Routes', group: 'Panels', action: { kind: 'panel', id: 'routes' } },
  { key: 'V', label: 'Fleet', group: 'Panels', action: { kind: 'panel', id: 'fleet' } },
  { key: 'U', label: 'Market', group: 'Panels', action: { kind: 'panel', id: 'market' } },
  { key: 'F', label: 'Finance', group: 'Panels', action: { kind: 'panel', id: 'finance' } },
  { key: 'N', label: 'Newspaper', group: 'Panels', action: { kind: 'panel', id: 'newspaper' } },
  { key: 'C', label: 'Contracts', group: 'Panels', action: { kind: 'panel', id: 'contracts' } },
  { key: 'B', label: 'Build toolbar', group: 'Panels', action: { kind: 'toolbar' } },
  { key: 'G', label: 'Goals', group: 'Panels', action: { kind: 'panel', id: 'goals' } },
  { key: 'O', label: 'Politics', group: 'Panels', action: { kind: 'panel', id: 'politics' } },
  { key: 'X', label: 'Rival', group: 'Panels', action: { kind: 'panel', id: 'rival' } },
  { key: 'E', label: 'Exchange', group: 'Panels', action: { kind: 'panel', id: 'exchange' } },
  { key: 'Y', label: 'Family', group: 'Panels', action: { kind: 'panel', id: 'family' } },
  { key: 'L', label: 'Legacy', group: 'Panels', action: { kind: 'panel', id: 'legacy' } },
  { key: 'J', label: 'Managers', group: 'Panels', action: { kind: 'panel', id: 'managers' } },
  { key: 'I', label: 'Codex', group: 'Panels', action: { kind: 'panel', id: 'codex' } },
  { key: 'T', label: 'Alerts', group: 'Panels', action: { kind: 'alerts' } },
  { key: 'M', label: 'Smog map', group: 'Map', action: { kind: 'overlay', id: 'pollution' } },
  { key: 'K', label: 'Faction map', group: 'Map', action: { kind: 'overlay', id: 'factions' } },
  { key: 'P', label: 'Photo mode', group: 'Map', action: { kind: 'photo' } },
  { key: 'Del', label: 'Bulldoze', group: 'Tools', action: { kind: 'bulldoze' } },
  { key: 'Esc', label: 'Cancel or close', group: 'Tools', action: { kind: 'escape' } },
  { key: '?', label: 'Show this help', group: 'Help', action: { kind: 'help' } },
  { key: 'H', label: 'Show this help', group: 'Help', action: { kind: 'help' } },
];

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = ['Time', 'Panels', 'Map', 'Tools', 'Help'];

const ALIASES: Record<string, string> = { space: ' ', esc: 'escape', del: 'delete' };

/** The KeyboardEvent.key value (lower case) a shortcut's display key matches. */
function eventKey(display: string): string {
  const k = display.toLowerCase();
  return ALIASES[k] ?? k;
}

/** The shortcut whose key is the (case-insensitive) KeyboardEvent.key, if any. */
export function shortcutForEvent(eventKeyValue: string): (Shortcut & { action: ShortcutAction }) | null {
  const k = eventKeyValue.toLowerCase();
  return SHORTCUTS.find((s) => eventKey(s.key) === k) ?? null;
}

/** The key text for an action ("F"), or null when it has none. Speed actions take the speed as `id` ("4"). */
export function shortcutFor(kind: ShortcutKind, id?: string): string | null {
  const s = SHORTCUTS.find((c) => {
    const a = c.action;
    if (a.kind !== kind) return false;
    if (id === undefined) return true;
    if (a.kind === 'speed') return String(a.speed) === id;
    return (a.kind === 'panel' || a.kind === 'overlay') && a.id === id;
  });
  return s ? s.key : null;
}

/** "Finance (F)", or the bare label when the action has no key. */
export function withShortcut(label: string, kind: ShortcutKind, id?: string): string {
  const key = shortcutFor(kind, id);
  return key ? `${label} (${key})` : label;
}
