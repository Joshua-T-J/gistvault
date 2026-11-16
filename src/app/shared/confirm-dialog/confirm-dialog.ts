import { Component, ElementRef, afterRenderEffect, inject, viewChild } from '@angular/core';
import { Icon } from '../icon/icon';
import { ConfirmService } from './confirm.service';

/**
 * The single confirmation dialog for the app, driven by `ConfirmService`.
 * Native `<dialog>` with `role="alertdialog"`: focus starts on Cancel (the safe choice), Esc
 * cancels, and the browser returns focus to whatever opened it.
 */
@Component({
  selector: 'app-confirm-dialog',
  imports: [Icon],
  template: `
    <dialog
      #dialog
      class="modal confirm"
      role="alertdialog"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-message"
      (cancel)="answer(false, $event)"
    >
      @if (confirm.request(); as request) {
        <div class="modal-body">
          <div class="head">
            @if (request.tone === 'danger') {
              <span class="badge" aria-hidden="true"><app-icon name="warning" [size]="20" /></span>
            }
            <h2 id="confirm-title">{{ request.title }}</h2>
          </div>
          <p id="confirm-message">{{ request.message }}</p>
        </div>
        <footer class="modal-footer">
          <button #cancel type="button" class="btn btn-outline" (click)="answer(false)">
            {{ request.cancelLabel ?? 'Cancel' }}
          </button>
          <button
            type="button"
            class="btn"
            [class.btn-danger]="request.tone === 'danger'"
            [class.btn-primary]="request.tone !== 'danger'"
            (click)="answer(true)"
          >
            {{ request.confirmLabel }}
          </button>
        </footer>
      }
    </dialog>
  `,
  styles: `
    .confirm {
      width: min(460px, calc(100vw - 32px));
    }
    .head {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    h2 {
      font-size: 22px;
    }
    .badge {
      display: inline-flex;
      flex: none;
      width: 40px;
      height: 40px;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      background: var(--danger-soft);
      color: var(--danger);
    }
    p {
      color: var(--body);
      line-height: 1.55;
    }
  `,
})
export class ConfirmDialog {
  protected readonly confirm = inject(ConfirmService);
  protected readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  protected readonly cancelButton = viewChild<ElementRef<HTMLButtonElement>>('cancel');

  constructor() {
    afterRenderEffect(() => {
      const open = this.confirm.request() !== null;
      const dialog = this.dialog().nativeElement;
      if (open && !dialog.open) {
        dialog.showModal();
        this.cancelButton()?.nativeElement.focus();
      } else if (!open && dialog.open) {
        dialog.close();
      }
    });
  }

  protected answer(confirmed: boolean, event?: Event): void {
    // Esc fires `cancel`; let the service close the dialog so state stays in one place.
    event?.preventDefault();
    this.confirm.request()?.settle(confirmed);
  }
}
