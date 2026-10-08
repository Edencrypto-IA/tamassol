export interface ReplayGuard {
  assertFresh(nonce: string, expiresAtMs: number, nowMs?: number): Promise<void>;
  consume(nonce: string, expiresAtMs: number, nowMs?: number): Promise<void>;
}

export interface NonceStore {
  getExpiry(nonce: string): Promise<number | null>;
  putIfAbsent(nonce: string, expiresAtMs: number): Promise<boolean>;
  deleteExpired(nowMs: number): Promise<void>;
}

export class MemoryNonceStore implements NonceStore {
  private readonly used = new Map<string, number>();

  async getExpiry(nonce: string): Promise<number | null> {
    return this.used.get(nonce) ?? null;
  }

  async putIfAbsent(nonce: string, expiresAtMs: number): Promise<boolean> {
    if (this.used.has(nonce)) return false;
    this.used.set(nonce, expiresAtMs);
    return true;
  }

  async deleteExpired(nowMs: number): Promise<void> {
    for (const [nonce, expiry] of this.used.entries()) {
      if (expiry <= nowMs) this.used.delete(nonce);
    }
  }
}

/**
 * Production-ready algorithm over an injected atomic NonceStore. Bind the store
 * to IndexedDB/SQLite/native secure storage in the real TAMASSOL app.
 */
export class StoreBackedReplayGuard implements ReplayGuard {
  constructor(private readonly store: NonceStore) {}

  async assertFresh(nonce: string, _expiresAtMs: number, nowMs = Date.now()): Promise<void> {
    await this.store.deleteExpired(nowMs);
    if ((await this.store.getExpiry(nonce)) !== null) {
      throw new Error("Approval nonce was already used.");
    }
  }

  async consume(nonce: string, expiresAtMs: number, nowMs = Date.now()): Promise<void> {
    await this.store.deleteExpired(nowMs);
    const inserted = await this.store.putIfAbsent(nonce, expiresAtMs);
    if (!inserted) throw new Error("Approval nonce was already used.");
  }
}

export class MemoryReplayGuard extends StoreBackedReplayGuard {
  constructor() {
    super(new MemoryNonceStore());
  }
}
