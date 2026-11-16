import { Service, signal } from '@angular/core';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** `danger` paints the confirm button red, for actions that can't be undone. */
  tone?: 'default' | 'danger';
}

export interface ConfirmRequest extends ConfirmOptions {
  settle(confirmed: boolean): void;
}

/**
 * Asks the user to confirm an action in an accessible modal dialog (`ConfirmDialog`, rendered
 * once in the app root). Resolves `true` only when the user presses the confirm button.
 */
@Service()
export class ConfirmService {
  readonly #request = signal<ConfirmRequest | null>(null);
  readonly request = this.#request.asReadonly();

  confirm(options: ConfirmOptions): Promise<boolean> {
    // A newer question replaces an unanswered one, which counts as "no".
    this.#request()?.settle(false);
    return new Promise<boolean>((resolve) => {
      const request: ConfirmRequest = {
        ...options,
        settle: (confirmed) => {
          if (this.#request() === request) this.#request.set(null);
          resolve(confirmed);
        },
      };
      this.#request.set(request);
    });
  }
}
