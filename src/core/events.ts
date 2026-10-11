import type { Building, GameDate, GoodId, NewsItem, OwnerId, Vec2 } from '../sim/types';

export type GameEvent =
  | { type: 'buildingPlaced'; building: Building }
  | { type: 'buildingRemoved'; buildingId: number }
  | { type: 'roadChanged'; tiles: Vec2[] }
  | { type: 'railChanged'; tiles: Vec2[] }
  | { type: 'sale'; cityId: number; goodId: GoodId; qty: number; revenue: number; ownerId: OwnerId; buildingId: number }
  | { type: 'dayStart'; date: GameDate }
  | { type: 'monthEnd'; date: GameDate }
  | { type: 'yearEnd'; year: number }
  | { type: 'news'; item: NewsItem }
  | { type: 'vehicleStuck'; vehicleId: number }
  | { type: 'unlock'; defId: string; kind: 'good' | 'building' | 'recipe' }
  | { type: 'toast'; message: string; tone: 'info' | 'good' | 'bad'; action?: { label: string; run: () => void } }
  | { type: 'achievement'; id: string }
  | { type: 'contract'; contractId: number; status: 'offered' | 'active' | 'done' | 'failed' }
  | { type: 'gameOver'; reason: string }
  | { type: 'victory'; reason: string };

export type GameEventType = GameEvent['type'];
export type EventOf<K extends GameEventType> = Extract<GameEvent, { type: K }>;

type Listener = (e: GameEvent) => void;

export class EventBus {
  private listeners = new Map<GameEventType, Listener[]>();
  private anyListeners: Listener[] = [];

  on<K extends GameEventType>(type: K, fn: (e: EventOf<K>) => void): () => void {
    const list = this.listeners.get(type) ?? [];
    const l = fn as Listener;
    this.listeners.set(type, [...list, l]);
    return () => {
      this.listeners.set(type, (this.listeners.get(type) ?? []).filter((x) => x !== l));
    };
  }

  onAny(fn: (e: GameEvent) => void): () => void {
    this.anyListeners = [...this.anyListeners, fn];
    return () => {
      this.anyListeners = this.anyListeners.filter((x) => x !== fn);
    };
  }

  emit(e: GameEvent): void {
    for (const fn of this.listeners.get(e.type) ?? []) fn(e);
    for (const fn of this.anyListeners) fn(e);
  }
}
