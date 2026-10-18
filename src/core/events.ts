import type { FactionId } from '../data/factions';
import type { LandmarkId } from '../data/landmarks';
import type { BuildingLevel } from '../sim/logistics/types';
import type { RetaliationKind } from '../sim/nemesis/types';
import type { Building, GameDate, GoodId, NewsItem, OwnerId, Vec2 } from '../sim/types';

export type GameEvent =
  | { type: 'buildingPlaced'; building: Building }
  | { type: 'buildingRemoved'; buildingId: number }
  /** an upgrade's works finished (sim/logistics/levels.ts worksDay) */
  | { type: 'buildingUpgraded'; buildingId: number; level: BuildingLevel; ownerId: OwnerId }
  /** a manager was hired (sim/logistics/managers.ts) */
  | { type: 'managerHired'; managerId: number; ownerId: OwnerId }
  /** a manager retired or quit; a fired one does not emit */
  | { type: 'managerLeft'; managerId: number; name: string; ownerId: OwnerId; reason: 'retired' | 'quit' }
  | { type: 'roadChanged'; tiles: Vec2[] }
  | { type: 'railChanged'; tiles: Vec2[] }
  /** tiles whose terrain changed (trees planted: sim/state.ts plantForest) */
  | { type: 'terrainChanged'; tiles: Vec2[] }
  | { type: 'ownershipChanged'; from: OwnerId; to: OwnerId }
  | { type: 'sale'; cityId: number; goodId: GoodId; qty: number; revenue: number; ownerId: OwnerId; buildingId: number }
  | { type: 'dayStart'; date: GameDate }
  | { type: 'monthEnd'; date: GameDate }
  | { type: 'yearEnd'; year: number }
  | { type: 'news'; item: NewsItem }
  | { type: 'vehicleStuck'; vehicleId: number }
  | { type: 'unlock'; defId: string; kind: 'good' | 'building' | 'recipe' }
  | { type: 'toast'; message: string; tone: 'info' | 'good' | 'bad'; action?: { label: string; run: () => void }; duration?: number }
  | { type: 'achievement'; id: string }
  | { type: 'contract'; contractId: number; status: 'offered' | 'active' | 'done' | 'failed' }
  | { type: 'landmarkBuilt'; cityId: number; id: LandmarkId }
  | { type: 'election'; cityId: number; winner: FactionId }
  /** an event card was answered (by the player or auto-resolved) */
  | { type: 'cardResolved'; cardId: string; uid: number }
  | { type: 'scandal'; cityId: number }
  /** a strike began at the player's works `buildingId` (sim/society/strikes.ts) */
  | { type: 'strike'; buildingId: number; cityId: number }
  /** the Baron retaliated (sim/nemesis/retaliation.ts); `cityId` is the town it hit, if any */
  | { type: 'baronStrike'; kind: RetaliationKind; cityId: number | null }
  | { type: 'gameOver'; reason: string }
  /** the Baron's bid for a majority of the player's shares (sim/nemesis/bid.ts) */
  | { type: 'hostileBid'; stage: 'started' | 'repelled' | 'lost' }
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
