import { h } from './dom';
import { SHORTCUTS, SHORTCUT_GROUPS } from './shortcuts';
import './help.css';

const MOUSE: [string, string][] = [
  ['Left-drag', 'Pan the map in Inspect'],
  ['Right or middle drag', 'Pan the map'],
  ['Wheel', 'Zoom at the cursor'],
  ['W A S D or arrows', 'Pan with the keyboard'],
];

const TOUCH: [string, string][] = [
  ['Drag', 'Always pan the map'],
  ['Pinch', 'Zoom'],
  ['Tap', 'Inspect, place, or demolish'],
  ['Tap, tap', 'Road / rail / trees: one end, then the other'],
  ['Done', 'Stop placing: Done on the coach, the Done chip, or re-tap the tool'],
];

/** Production loop primer above the hotkeys (E5). */
export const SYSTEMS_PRIMER: { step: string; detail: string }[] = [
  { step: 'Extract', detail: 'Pull raw goods from the land (wood, ore, grain).' },
  { step: 'Refine', detail: 'Turn raw into materials (lumber, steel, flour).' },
  { step: 'Components', detail: 'Make parts (wire, motors) for deeper consumer chains.' },
  { step: 'Manufacture', detail: 'Assemble finished goods towns will buy.' },
  { step: 'Retail / Trade', detail: 'Sell in stores, or dump materials and parts at a Trading House.' },
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
    h('h2', null, 'How the works run'),
    h('ol', { class: 'help-primer', 'data-help': 'primer' },
      SYSTEMS_PRIMER.map((s) =>
        h('li', null, h('strong', null, s.step), h('span', null, s.detail)))),
    h('p', { class: 'help-primer-pointers', 'data-help': 'pointers' },
      'Open the ', h('kbd', { class: 'help-key' }, 'I'), ' Codex for every good and recipe, and ',
      h('kbd', { class: 'help-key' }, 'T'), ' Alerts when something needs fixing.'),
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
    h('h3', null, 'Touch'),
    h('ul', { class: 'help-list', 'data-help': 'touch' },
      TOUCH.map(([k, l]) => h('li', null, h('kbd', { class: 'help-key' }, k), h('span', null, l)))),
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
