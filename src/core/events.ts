// Synchronous event bus for sim→render/audio signalling (TECH_SPEC.md §3). /sim raises
// events (a Stroke fired, a Blot died, a Gate resolved) that /render and /audio react to
// without /sim ever importing either — this is the one-way door between them.
//
// Listeners must not subscribe or unsubscribe from within a handler (defer to next tick
// if needed): emit() walks the live listener array directly rather than a defensive
// copy, so it stays allocation-free when called from the sim hot path.

export type Listener<T> = (payload: T) => void;

export class EventBus<Events extends object> {
  private readonly listeners = new Map<keyof Events, Listener<never>[]>();

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    let list = this.listeners.get(event);
    if (list === undefined) {
      list = [];
      this.listeners.set(event, list);
    }
    list.push(listener as Listener<never>);
    return (): void => this.off(event, listener);
  }

  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    const list = this.listeners.get(event);
    if (list === undefined) return;
    const idx = list.indexOf(listener as Listener<never>);
    if (idx !== -1) list.splice(idx, 1);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const list = this.listeners.get(event);
    if (list === undefined) return;
    for (const listener of list) {
      (listener as Listener<Events[K]>)(payload);
    }
  }

  /** Removes every listener for every event. Used between Passages / in test teardown. */
  clear(): void {
    this.listeners.clear();
  }
}
