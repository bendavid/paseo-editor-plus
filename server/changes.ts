/** Listeners told which key changed, such as a package or component id. */
export class Changes<Key> {
  private readonly listeners = new Set<(key: Key) => void>();

  /** Calls `listener` on each change until the returned function is called. */
  listen(listener: (key: Key) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(key: Key): void {
    for (const listener of this.listeners) listener(key);
  }
}
