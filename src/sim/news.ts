import { nextId } from './state';
import type { NewsItem, NewsKind, SimContext } from './types';

export const MAX_NEWS = 200;

export function publishNews(ctx: SimContext, kind: NewsKind, headline: string, body: string, tag?: string): NewsItem {
  const { state, bus } = ctx;
  const item: NewsItem = { id: nextId(state), date: { ...state.date }, headline, body, kind };
  if (tag !== undefined) item.tag = tag;
  state.news.push(item);
  if (state.news.length > MAX_NEWS) state.news.splice(0, state.news.length - MAX_NEWS);
  bus.emit({ type: 'news', item });
  return item;
}
