import { BUILDINGS } from '../data/buildings';
import { GOODS } from '../data/goods';
import { lifecycleFactor } from './market';
import { publishNews } from './news';
import { unlockedAt } from './state';
import type { GameState, SimContext } from './types';

export interface Era {
  name: string;
  start: number;
  end: number;
  blurb: string;
}

export const ERAS: Era[] = [
  { name: 'Steam Age', start: 1900, end: 1919, blurb: 'Smoke, steam and honest toil: the century dawns on chimneys and cobbles.' },
  { name: 'Roaring Age', start: 1920, end: 1939, blurb: 'Jazz, motorcars and wireless sets: money flows and so does the gin.' },
  { name: 'Atomic Age', start: 1940, end: 1959, blurb: 'Victory, suburbs and television: the future glows with promise.' },
  { name: 'Space Age', start: 1960, end: 1979, blurb: 'Rockets, plastics and bell-bottoms: the whole world looks up.' },
  { name: 'Silicon Age', start: 1980, end: 2000, blurb: 'Microchips hum in every home: the information age is upon us.' },
];

export function eraName(year: number): string {
  const era = ERAS.find((e) => year >= e.start && year <= e.end);
  if (era) return era.name;
  return year < ERAS[0].start ? ERAS[0].name : ERAS[ERAS.length - 1].name;
}

export function isUnlocked(state: GameState, id: string): boolean {
  return state.unlocked.includes(id);
}

/** Flavourful announcements for buildings and tier-2 (or plastic) goods, keyed by id. */
const INVENTIONS: Record<string, [headline: string, body: string]> = {
  oil_well: ['BLACK GOLD! Oil found beneath the plains', 'Wildcatters strike crude: oil wells, refineries and fuel are now possible.'],
  refinery: ['BLACK GOLD! Oil found beneath the plains', 'Refineries now turn crude into fuel.'],
  car_plant: ['HORSELESS CARRIAGE TAKES TOWN BY STORM', 'Automobile plants now possible.'],
  cars: ['HORSELESS CARRIAGE TAKES TOWN BY STORM', 'Automobile plants now possible.'],
  electronics_plant: ['WIRELESS WONDER: Electronics plants open their doors', 'Valves, wires and solder: electronics plants are now possible.'],
  radios: ['WIRELESS WONDER: Radios in every parlour', 'Families gather round the new wireless set.'],
  plastic: ['PLASTICS: The material of tomorrow arrives', 'Chemists unveil a miracle material that moulds into anything.'],
  tvs: ['PICTURES IN THE PARLOUR: Television arrives', 'Television sets are now in the shops.'],
  computers: ['THE MICROCHIP REVOLUTION: Computers come home', 'Home computers are now possible.'],
};

const unlockKind = (id: string): 'good' | 'building' | 'recipe' => (GOODS[id] ? 'good' : BUILDINGS[id] ? 'building' : 'recipe');

/** Last complete check per `state.unlocked` array (outside GameState; see checkUnlocks). */
const checkedUnlocks = new WeakMap<string[], { year: number; length: number }>();

/** On day: unlock anything newly eligible for the current year; announce notable inventions. */
export function checkUnlocks(ctx: SimContext): void {
  const { state, bus } = ctx;
  const year = state.date.year;
  if (year >= 1910 && !state.flags.oilRevealed) state.flags.oilRevealed = true;
  // runs daily but unlocks only change with the year: skip when this very list was already complete
  // for this year (same array, same length as after the last check)
  const seen = checkedUnlocks.get(state.unlocked);
  if (seen && seen.year === year && seen.length === state.unlocked.length) return;
  const have = new Set(state.unlocked);
  const fresh = unlockedAt(year).filter((id) => !have.has(id));
  checkedUnlocks.set(state.unlocked, { year, length: state.unlocked.length + fresh.length });
  if (fresh.length === 0) return;
  state.unlocked.push(...fresh);
  const told = new Set<string>();
  for (const id of fresh) {
    bus.emit({ type: 'unlock', defId: id, kind: unlockKind(id) });
    const story = INVENTIONS[id];
    if (story && !told.has(story[0])) {
      told.add(story[0]);
      publishNews(ctx, 'invention', story[0], story[1]);
    }
  }
}

const FADE_LINES: Record<string, string> = {
  radios: 'Radios losing their crackle with the young set',
};

/** On year: warn the year before a good fades, and when its demand first halves. */
export function fadeWarnings(ctx: SimContext): void {
  const year = ctx.state.date.year;
  for (const g of Object.values(GOODS)) {
    if (g.fadeYear === null) continue;
    const line = FADE_LINES[g.id] ?? `${g.name} sales are fading`;
    if (year === g.fadeYear - 1) {
      publishNews(ctx, 'warning', line, `Demand for ${g.name.toLowerCase()}s is expected to decline from next year.`);
    } else if (lifecycleFactor(g.id, year) <= 0.5 && lifecycleFactor(g.id, year - 1) > 0.5) {
      publishNews(ctx, 'warning', `${g.name} demand halves`, `Shoppers have moved on: ${g.name.toLowerCase()} demand is down by half.`);
    }
  }
}

/** On the first day of a new era: toast plus a historic story. */
export function eraBanner(ctx: SimContext): void {
  const { year, month, day } = ctx.state.date;
  if (month !== 1 || day !== 1) return;
  const era = ERAS.find((e) => e.start === year && e.start !== ERAS[0].start);
  if (!era) return;
  ctx.bus.emit({ type: 'toast', message: `The ${era.name} begins!`, tone: 'info' });
  publishNews(ctx, 'historic', `The ${era.name} begins!`, era.blurb);
}
