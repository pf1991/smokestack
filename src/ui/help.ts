import { h } from './dom';
import { SHORTCUTS, SHORTCUT_GROUPS } from './shortcuts';
import './help.css';

const MOUSE: [string, string][] = [
  ['Left-drag', 'Pan the map in Inspect'],
  ['Right or middle drag', 'Pan the map'],
  ['Wheel or pinch', 'Zoom at the cursor'],
  ['W A S D or arrows', 'Pan with the keyboard'],
];

let open: { root: HTMLElement; prevFocus: Element | null } | null = null;

export function isHelpOpen(): boolean {
  return open !== null;
}

export function closeHelp(): void {
  if (!open) return;
  const { root, prevFocus } = open;
  open = null;
  root.remove();
  if (prevFocus instanceof HTMLElement && prevFocus.isConnected) prevFocus.focus();
}

export function openHelp(): void {
  if (open) return;
  const card = h('div', { class: 'help-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Help', tabindex: '-1' },
    h('h2', null, 'Controls'),
    SHORTCUT_GROUPS.map((g) => {
      // H duplicates "?" so list each label once
      const rows = SHORTCUTS.filter((s) => s.group === g);
      const merged: { keys: string[]; label: string }[] = [];
      for (const s of rows) {
        const prior = merged.find((m) => m.label === s.label);
        if (prior) prior.keys.push(s.key);
        else merged.push({ keys: [s.key], label: s.label });
      }
      return [
        h('h3', null, g),
        h('ul', { class: 'help-list' },
          merged.map((m) => h('li', null,
            m.keys.map((k) => h('kbd', { class: 'help-key' }, k)), h('span', null, m.label)))),
      ];
    }),
    h('h3', null, 'Mouse'),
    h('ul', { class: 'help-list' },
      MOUSE.map(([k, l]) => h('li', null, h('kbd', { class: 'help-key' }, k), h('span', null, l)))),
    h('p', { class: 'help-hint' }, 'Esc or click outside to close'));
  const root = h('div', { class: 'help-modal' }, card);
  root.addEventListener('pointerdown', (e) => {
    if (e.target === root) closeHelp();
  });
  const prevFocus = document.activeElement;
  document.body.appendChild(root);
  open = { root, prevFocus };
  card.focus();
}

export function toggleHelp(): void {
  if (open) closeHelp();
  else openHelp();
}
