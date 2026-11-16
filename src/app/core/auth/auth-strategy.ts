import { InjectionToken } from '@angular/core';

export type RememberMode = 'memory' | 'session';

export interface LoginInput {
  /** Personal access token (Advanced path). Omit to use Sign in with GitHub. */
  token?: string;
  remember?: RememberMode;
  /** Sign in with GitHub only: where to land afterwards (a path under /app, /c/ or /explore). */
  returnTo?: string;
}

/**
 * The migration seam between Option A (personal access token) and Option B (BFF cookie).
 * Nothing outside `core/auth` should depend on which strategy is active.
 */
export type AuthKind = 'pat' | 'bff';

export interface AuthStrategy {
  readonly kind: AuthKind;
  readonly apiBase: string;
  readonly withCredentials: boolean;
  authHeaders(): Record<string, string>;
  login(input?: LoginInput): Promise<void>;
  restore(): Promise<boolean>;
  tryRefresh(): Promise<boolean>;
  logout(opts?: { revoke?: boolean }): Promise<void>;
}

export const AUTH_STRATEGY = new InjectionToken<AuthStrategy>('AUTH_STRATEGY');

export class InvalidTokenFormatError extends Error {
  constructor() {
    super('That doesn’t look like a GitHub token. It should start with github_pat_ or ghp_.');
    this.name = 'InvalidTokenFormatError';
  }
}
