import { describe, expect, it } from 'vitest';
import { southWall } from './terrain';

describe('southWall', () => {
  it('raised ground above lower ground shows a face', () => {
    expect(southWall('mountain', 'grass')).toBe('rock');
    expect(southWall('mountain', 'hills')).toBe('rock');
    expect(southWall('hills', 'forest')).toBe('hill');
    expect(southWall('hills', 'water')).toBe('hill');
    expect(southWall('sand', 'water')).toBe('bank');
    expect(southWall('grass', 'water')).toBe('bank');
  });
  it('level or rising ground, water and the map edge show none', () => {
    expect(southWall('hills', 'hills')).toBeNull();
    expect(southWall('hills', 'mountain')).toBeNull();
    expect(southWall('grass', 'sand')).toBeNull();
    expect(southWall('water', 'water')).toBeNull();
    expect(southWall('mountain', undefined)).toBeNull();
  });
});
