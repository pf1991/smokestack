/**
 * Law cards (Phase 3 Task 5): one per national smoke law, opened by sim/society/regulation.ts when
 * the law passes (trigger 'law': the spring draw never picks them). Comply is free; lobbying for
 * delay costs money, risks a scandal in the dirtiest town and may be used once per law.
 */
import { LAWS, type LawId } from '../laws';
import { lobbyForDelay } from '../../sim/society/lawState';
import { nation, scandalRisk } from './helpers';
import type { CardDef } from './types';
import type { SimContext } from '../../sim/types';

const ANY: [number, number] = [1901, 2000];
const LOBBY_SCANDAL_RISK = 0.15;

/** Lobbies against law `id`: delays enforcement and raises scandal risk in the smokiest town. */
function lobby(id: LawId) {
  return (ctx: SimContext): void => {
    if (!lobbyForDelay(ctx.state, id)) return;
    let worst = ctx.state.cities[0];
    for (const c of ctx.state.cities) if (c.smog.level > worst.smog.level) worst = c;
    if (worst) scandalRisk(ctx, worst.id, LOBBY_SCANDAL_RISK);
  };
}

function lawCard(id: LawId, title: string, body: string): CardDef {
  return {
    id: LAWS[id].cardId,
    title,
    body,
    trigger: 'law',
    years: ANY,
    weight: 1,
    cooldownYears: 0,
    needsCity: false,
    choices: [
      { label: 'Comply', cost: 0, effects: [nation('reformers', 2)], note: `Fines start when the law passes, for works below scrubber tier ${LAWS[id].tier}` },
      {
        label: 'Lobby for delay',
        cost: 9000,
        effects: [nation('reformers', -5), nation('oldmoney', 3)],
        apply: lobby(id),
        note: 'Delays the fines by 24 months (once per law). The papers may smell a scandal',
      },
      { label: 'Praise it publicly', cost: 500, effects: [nation('reformers', 6)], note: 'Fines start when the law passes' },
    ],
    defaultChoice: 0,
  };
}

export const LAW_CARDS: readonly CardDef[] = [
  lawCard('smoke_abatement', 'Smoke Abatement Act', 'Parliament has outlawed black smoke. Every works that pollutes needs a scrubber, or pays a monthly fine.'),
  lawCard('clean_air', 'The Clean Air Act', 'After the winter fogs, the Clean Air Act demands better scrubbers of every smoking works in the land.'),
  lawCard('emission_caps', 'Emission Caps', 'Statutory emission caps arrive. Only the best scrubbers will do; the rest will be fined each month.'),
];
