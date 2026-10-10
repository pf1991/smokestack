import { describe, expect, it } from 'vitest';
import { MAX_NEWS, publishNews } from './news';
import { testCtx } from './testkit';
import type { NewsItem } from './types';

describe('publishNews', () => {
  it('stores the item with the current date and emits a news event', () => {
    const ctx = testCtx();
    const seen: NewsItem[] = [];
    ctx.bus.on('news', (e) => seen.push(e.item));
    const item = publishNews(ctx, 'invention', 'HORSELESS CARRIAGE!', 'Automobiles now possible.');
    expect(item.headline).toBe('HORSELESS CARRIAGE!');
    expect(item.kind).toBe('invention');
    expect(item.date).toEqual(ctx.state.date);
    expect(item.date).not.toBe(ctx.state.date);
    expect(ctx.state.news.at(-1)).toEqual(item);
    expect(seen).toEqual([item]);
  });

  it('gives each item a unique id', () => {
    const ctx = testCtx();
    const a = publishNews(ctx, 'random', 'A', '');
    const b = publishNews(ctx, 'random', 'B', '');
    expect(a.id).not.toBe(b.id);
  });

  it(`keeps only the latest ${MAX_NEWS} items`, () => {
    const ctx = testCtx();
    for (let i = 0; i < MAX_NEWS + 25; i++) publishNews(ctx, 'market', `H${i}`, '');
    expect(ctx.state.news.length).toBe(MAX_NEWS);
    expect(ctx.state.news[0].headline).toBe('H25');
    expect(ctx.state.news.at(-1)!.headline).toBe(`H${MAX_NEWS + 24}`);
  });
});
