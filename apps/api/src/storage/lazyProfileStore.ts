import type { ManagedProfileRepository } from "./profileRepository.js";

/**
 * How long a profile database may sit untouched before it is closed again. Long enough that a user
 * moving between screens never pays a reopen, short enough that a family of profiles does not stay
 * resident all day after a single glance at each one.
 */
export const defaultIdleTimeoutMs = 5 * 60 * 1000;

export interface LazyProfileStoreOptions {
  profileId: string;
  /** Opens the underlying database. Called at most once per resident period. */
  open: () => Promise<ManagedProfileRepository>;
  /** Already-open store to adopt, used when the caller had to create the database to register it. */
  initial?: ManagedProfileRepository;
  now?: () => number;
}

/**
 * Defers opening a profile database until something actually reads or writes it, and closes it
 * again once it goes idle.
 *
 * Opening every profile at startup cost linear boot latency and held a configured memory limit per
 * profile for databases nobody had asked for. Callers keep the synchronous `getStore()` they always
 * had because {@link repository} is a facade: every member of `ManagedProfileRepository` is already
 * asynchronous, so the open can hide inside the call the caller was going to await anyway.
 */
export class LazyProfileStore {
  readonly profileId: string;
  /** The `ManagedProfileRepository` handed to callers. Opening happens on first use. */
  readonly repository: ManagedProfileRepository;

  private readonly openStore: () => Promise<ManagedProfileRepository>;
  private readonly now: () => number;
  private opened: Promise<ManagedProfileRepository> | undefined;
  private inFlight = 0;
  private lastUsedAt: number;

  constructor(options: LazyProfileStoreOptions) {
    this.profileId = options.profileId;
    this.openStore = options.open;
    this.now = options.now ?? Date.now;
    this.lastUsedAt = this.now();
    if (options.initial) {
      this.opened = Promise.resolve(options.initial);
    }
    this.repository = this.createFacade();
  }

  /** True while a database handle is resident. Diagnostics and tests only. */
  get isOpen(): boolean {
    return this.opened !== undefined;
  }

  /**
   * Closes the database if it is resident, idle, and has been untouched for `idleTimeoutMs`.
   * Resolves to whether it actually closed.
   */
  async evictIfIdle(idleTimeoutMs: number): Promise<boolean> {
    if (!this.opened || this.inFlight > 0 || this.now() - this.lastUsedAt < idleTimeoutMs) {
      return false;
    }
    await this.close();
    return true;
  }

  /**
   * Closes the database if it is resident and leaves the handle reusable: the next call reopens.
   * Safe to call on a store that was never opened.
   */
  async close(): Promise<void> {
    const opened = this.opened;
    this.opened = undefined;
    if (!opened) {
      return;
    }
    const store = await opened.catch(() => undefined);
    await store?.close();
  }

  private ensureOpen(): Promise<ManagedProfileRepository> {
    if (!this.opened) {
      // Clear the slot on failure so a transient open error does not poison the profile forever.
      this.opened = this.openStore().catch((error: unknown) => {
        this.opened = undefined;
        throw error;
      });
    }
    return this.opened;
  }

  private async invoke(method: string, args: unknown[]): Promise<unknown> {
    // Counted before the open is awaited: an eviction sweep must not close a database out from
    // under a caller that is still waiting for it to finish opening.
    this.inFlight += 1;
    try {
      const store = await this.ensureOpen();
      const target = store as unknown as Record<string, (...values: unknown[]) => unknown>;
      return await target[method](...args);
    } finally {
      this.inFlight -= 1;
      this.lastUsedAt = this.now();
    }
  }

  private createFacade(): ManagedProfileRepository {
    const facade = new Proxy({} as Record<string | symbol, unknown>, {
      get: (_target, property) => {
        // A facade that answers `then` with a function would be mistaken for a promise and awaited
        // into oblivion by anything that resolves it.
        if (typeof property !== "string" || property === "then") {
          return undefined;
        }
        if (property === "profileId") {
          return this.profileId;
        }
        if (property === "close") {
          return () => this.close();
        }
        return (...args: unknown[]) => this.invoke(property, args);
      }
    });
    return facade as unknown as ManagedProfileRepository;
  }
}
