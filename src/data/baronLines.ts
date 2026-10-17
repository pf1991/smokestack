/**
 * The Baron's voice (Phase 4): quips that follow his character traits, a line for each kind of
 * retaliation, and the lines only his son, Junior (generation 2), would say. `{player}` is the
 * player's company name and `{city}` a town; sim/rival/taunts.ts and sim/nemesis/retaliation.ts fill them.
 */
import type { BaronTrait, RetaliationKind } from '../sim/nemesis/types';

export interface BaronLines {
  trait: Record<BaronTrait, readonly string[]>;
  retaliation: Record<RetaliationKind, readonly string[]>;
  junior: readonly string[];
}

export const BARON_LINES: BaronLines = {
  trait: {
    greedy: [
      'Every penny {player} earns in {city} is a penny stolen from my waistcoat.',
      'I do not want a bigger slice, {player}. I want the bakery.',
      'Charity begins at home, and my home has forty bedrooms to heat.',
      'Count your coins while you can, {player}. I am already counting them for you.',
      'The till in {city} rings sweeter when it rings for me.',
    ],
    vindictive: [
      'I keep a little book, {player}. Your name is on every page.',
      'The people of {city} may forget what you did. I never shall.',
      'Revenge is a dish best served cold, and I own the ice works.',
      'Sleep well, {player}. Somebody ought to.',
      'I have outlived better men than you, and attended their auctions.',
    ],
    showman: [
      'Ladies and gentlemen of {city}: behold the future, and it wears a top hat.',
      'Print my name larger, boy. {player} may have the small type.',
      'I shall hire a brass band to play at the funeral of {player}.',
      'Nobody remembers the second chimney on the skyline. They remember mine.',
      'Every great show needs a clown. Thank you for volunteering, {player}.',
    ],
    cunning: [
      'Your foreman in {city} sends his regards. Well, my regards, really.',
      'A wise man never fights a war he has not already bought.',
      'I know what {player} will do next quarter. Do you?',
      'Half the council of {city} dines at my table. The other half wishes it did.',
      'Play chess with me, {player}, and you will find I own the board.',
    ],
  },
  retaliation: {
    price_war: [
      'Let us see how long {player} can sell at a loss in {city}. I have deep pockets and a long memory.',
      'Half price in {city}! Tell your friends. Tell {player}.',
      'A gentleman pays his debts. I simply make sure his rivals cannot.',
      'Cheaper, better, mine. The people of {city} need no other slogan.',
    ],
    poach: [
      'Your foremen in {city} have discovered the joy of a Smogsworth pay packet.',
      'Loyalty, {player}, is a commodity like any other. I bought the lot.',
      'Good men go where the money is. Today it is my yard.',
      'Do give my best to whoever is left at your works in {city}.',
    ],
    fund_opponent: [
      'Democracy is a marvellous thing. I bought a little of it in {city}.',
      'My candidate in {city} has fine whiskers and an even finer patron.',
      'Every vote is sacred, {player}. Some are simply more expensive.',
      'I do not run for office. I furnish it.',
    ],
    smear: [
      'I said nothing the newspapers did not want to print anyway.',
      'Mud sticks, {player}. I buy it by the cartload.',
      'The editor in {city} and I see eye to eye, especially on you.',
      'Reputation takes a lifetime to build, and a single headline to sell.',
    ],
    sabotage: [
      'Fires are such dreadful accidents. You really should mind your stoves in {city}.',
      'I was at the opera all evening, Inspector. Ask anyone I pay.',
      'Machines break, {player}. Some of them need a little encouragement.',
      'How unfortunate. I shall send flowers to {city}. Fireproof ones.',
    ],
    hostile_bid: [
      'Your shares are on the market, {player}, and so, it seems, are you.',
      'I am not taking over {player}. I am adopting it.',
      'Every share you sell is a brick in my new wing.',
      'Shareholders love a generous man. I am feeling very generous.',
    ],
  },
  junior: [
    'Father built the empire. I intend to modernise it, starting with {player}.',
    'The old man was too soft on {player}. I am not the old man.',
    'Father wore a top hat. I wear a homburg, and I shall wear it to your auction, {player}.',
    'Father left me his chimneys, his grudges and his tailor. I kept the grudges.',
    'They call me Junior. They will call me Sir in {city} soon enough.',
    'I went to Oxford, {player}. You went to the poorhouse.',
  ],
};

/** Fills `{player}` and `{city}` in one of the Baron's lines (or a taunt). */
export function fillBaronLine(text: string, player: string, city: string): string {
  // "Gilded Gear & Co." at the end of a sentence must not end in ".."
  return text.split('{player}').join(player).split('{city}').join(city).replace(/\.\./g, '.');
}
