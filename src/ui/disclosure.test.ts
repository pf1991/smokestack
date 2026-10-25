// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  coachSeen,
  coachStorageKey,
  markCoachSeen,
  nowCard,
  progressiveDisclosure,
} from './disclosure';
import { h } from './dom';

beforeEach(() => localStorage.clear());
afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe('disclosure coach storage', () => {
  it('keys and marks a panel coach as seen', () => {
    expect(coachStorageKey('politics')).toBe('smokestack:coach:politics');
    expect(coachSeen('politics')).toBe(false);
    markCoachSeen('politics');
    expect(coachSeen('politics')).toBe(true);
    expect(localStorage.getItem('smokestack:coach:politics')).toBe('seen');
  });
});

describe('nowCard', () => {
  it('lists decision lines under Now', () => {
    const el = nowCard([
      { label: 'Election in Ashford', detail: 'in 5 months', tone: 'info' },
      { label: 'Workers souring', detail: '▼ −4 this year', tone: 'warning' },
    ]);
    expect(el.dataset.disc).toBe('now');
    expect(el.querySelector('.kit-card-title')!.textContent).toBe('Now');
    const items = [...el.querySelectorAll('.disc-now-item')];
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('Election in Ashford');
    expect(items[1].dataset.tone).toBe('warning');
  });

  it('shows an empty line when there are no items', () => {
    const el = nowCard([], 'Quiet on the hill.');
    expect(el.querySelector('.disc-empty')!.textContent).toBe('Quiet on the hill.');
  });
});

describe('progressiveDisclosure', () => {
  it('summary-first: full block hidden until Show full; expand reveals it and marks coach', () => {
    const view = progressiveDisclosure({
      panelId: 'politics',
      expandLabel: 'Show full Politics',
      coachText: 'Start with the decisions above; open the full ledger when you need every faction.',
      now: nowCard([{ label: 'Next election soon' }]),
      full: h('div', { class: 'pol-full-tables' }, 'dense tables'),
    });
    document.body.appendChild(view.el);

    expect(view.el.querySelector('[data-disc="now"]')).not.toBeNull();
    expect(view.el.querySelector('[data-disc="coach"]')!.textContent).toContain('Start with the decisions');
    const full = view.el.querySelector('[data-disc="full"]') as HTMLElement;
    expect(full.hidden).toBe(true);
    expect(view.expanded()).toBe(false);
    expect(full.textContent).toContain('dense tables');

    (view.el.querySelector('[data-disc="toggle"]') as HTMLElement).click();
    expect(full.hidden).toBe(false);
    expect(view.expanded()).toBe(true);
    expect(coachSeen('politics')).toBe(true);
    expect(view.el.querySelector('[data-disc="coach"]')).toBeNull();
    expect((view.el.querySelector('[data-disc="toggle"] .kit-btn-label') as HTMLElement).textContent).toBe(
      'Hide full Politics',
    );
  });

  it('skips the coach when already seen', () => {
    markCoachSeen('finance');
    const view = progressiveDisclosure({
      panelId: 'finance',
      expandLabel: 'Show full ledger',
      coachText: 'unused',
      now: nowCard([{ label: 'Cash' }]),
      full: h('div', null, 'ledger'),
    });
    expect(view.el.querySelector('[data-disc="coach"]')).toBeNull();
  });
});
