import { BARON_LINES, fillBaronLine } from '../../data/baronLines';
import { heaviestGrudge } from '../nemesis/grudges';
import { publishNews } from '../news';
import { chance, pick } from '../rng';
import type { GameState, SimContext } from '../types';

export const TAUNT_CHANCE = 0.3;

/** `{player}` = the player's company name, `{city}` = a random city. */
export const TAUNTS: readonly string[] = [
  'Your furniture would embarrass a woodpecker.',
  'I have seen sturdier enterprises built of wet cardboard, {player}.',
  'The good people of {city} deserve better than your shoddy wares. They deserve mine.',
  'Competition? I had to have my butler look up the word.',
  'My monocle fogged over with pity upon reading the ledgers of {player}.',
  'I shall buy {city} a brass bandstand with your market share.',
  'Smoke is the smell of money, and you, sir, smell of fresh air.',
  'Your lorries are so slow the bread goes stale before it leaves the county.',
  '{player}? I took it for a laundry.',
  'A gentleman never gloats. Fortunately, I am a Baron.',
  'I take upstarts like {player} with my morning kippers.',
  'Mark my words: by Michaelmas, {city} will be Smogsworth country.',
  'Your factory whistle is flat, sir. Rather like your profits.',
  'I do not undercut my rivals. I merely price them into the history books.',
  'My top hat is worth more than your entire fleet.',
  'Should {player} require employment, my boot-blacking department is hiring.',
  'Progress waits for no man, and it is certainly not waiting for you.',
  'They call me ruthless. I prefer "punctual".',
  'The bankers of {city} laugh at the mere mention of {player}. I taught them the joke.',
  'Enjoy your little empire while it lasts. I have already ordered the wrecking ball.',
];

const TAUNT_BODIES: readonly string[] = [
  'The Baron delivered the remark between puffs of a fat cigar at the {city} Exchange.',
  '{baron} said so to our reporter on the steps of the {city} Grand Hotel, polishing his monocle.',
  'The quip, made over brandy at the {city} Gentlemen\'s Club, drew polite and slightly frightened laughter.',
  'Smogsworth Consolidated declined to elaborate, but its chimneys in {city} were seen smoking harder than usual.',
];

/** the share of taunts drawn from the head's own voice (his traits' lines, and Junior's) */
export const TRAIT_TAUNT_SHARE = 0.5;

/** The head's own lines: those of each of his traits, in trait order, then Junior's when he is generation 2. */
export function voiceLines(state: GameState): string[] {
  const n = state.nemesis;
  const out: string[] = [];
  for (const t of n.traits) out.push(...BARON_LINES.trait[t]);
  if (n.head.generation === 2) out.push(...BARON_LINES.junior);
  return out;
}

/**
 * The town a taunt names: the town of the Baron's heaviest grudge if it has one (he talks about what
 * galls him), otherwise a random town.
 */
function tauntCity(state: GameState): string {
  const g = heaviestGrudge(state);
  const sore = g && g.cityId !== null ? state.cities.find((c) => c.id === g.cityId) : undefined;
  if (sore) return sore.name;
  return state.cities.length > 0 ? pick(state, state.cities).name : 'town';
}

/**
 * Monthly, with probability TAUNT_CHANCE: a `rival` news item with one of the Baron's quips. Half of
 * them (TRAIT_TAUNT_SHARE) come from his own voice (voiceLines), the rest from the classic TAUNTS.
 */
export function rivalTaunt(ctx: SimContext): void {
  const { state } = ctx;
  if (!state.companies.rival.active) return;
  if (!chance(state, TAUNT_CHANCE)) return;
  const own = voiceLines(state);
  const quip = own.length > 0 && chance(state, TRAIT_TAUNT_SHARE) ? pick(state, own) : pick(state, TAUNTS);
  const body = pick(state, TAUNT_BODIES).split('{baron}').join(state.nemesis.head.name);
  const city = tauntCity(state);
  const player = state.companies.player.name;
  publishNews(ctx, 'rival', `Smogsworth: '${fillBaronLine(quip, player, city)}'`, fillBaronLine(body, player, city));
}
