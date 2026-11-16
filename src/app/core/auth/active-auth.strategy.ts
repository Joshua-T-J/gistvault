import { Injectable, inject, signal } from '@angular/core';
import { AuthKind, AuthStrategy, LoginInput } from './auth-strategy';
import { BffAuthStrategy } from './bff-auth.strategy';
import { PatAuthStrategy } from './pat-auth.strategy';

/**
 * The AUTH_STRATEGY the app uses: forwards to whichever strategy signed the user in, so the
 * interceptors, repository and sync code never need to know how the user connected.
 */
@Injectable()
export class ActiveAuthStrategy implements AuthStrategy {
  readonly #pat = inject(PatAuthStrategy);
  readonly #bff = inject(BffAuthStrategy);
  readonly #active = signal<AuthKind>('pat');

  get kind(): AuthKind {
    return this.#active();
  }

  get apiBase(): string {
    return this.#current().apiBase;
  }

  get withCredentials(): boolean {
    return this.#current().withCredentials;
  }

  authHeaders(): Record<string, string> {
    return this.#current().authHeaders();
  }

  async login(input: LoginInput = {}): Promise<void> {
    if (input.token !== undefined) {
      await this.#pat.login(input);
      this.#active.set('pat');
      return;
    }
    this.#active.set('bff');
    await this.#bff.login(input);
  }

  /** A token remembered for this tab wins; otherwise a Sign in with GitHub session, if any. */
  async restore(): Promise<boolean> {
    if (await this.#pat.restore()) {
      this.#active.set('pat');
      return true;
    }
    if (await this.#bff.restore()) {
      this.#active.set('bff');
      return true;
    }
    return false;
  }

  tryRefresh(): Promise<boolean> {
    return this.#current().tryRefresh();
  }

  async logout(opts?: { revoke?: boolean }): Promise<void> {
    try {
      await this.#current().logout(opts);
    } finally {
      this.#active.set('pat');
    }
  }

  #current(): AuthStrategy {
    return this.#active() === 'bff' ? this.#bff : this.#pat;
  }
}
