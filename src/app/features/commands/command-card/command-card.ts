import { Component, computed, input, output } from '@angular/core';
import { Command } from '../../../core/storage/vault.models';
import { Icon } from '../../../shared/icon/icon';

@Component({
  selector: 'app-command-card',
  imports: [Icon],
  template: `
    <article
      class="card command"
      [class.selected]="selectable() && selected()"
      [attr.aria-labelledby]="titleId()"
    >
      <div class="top">
        @if (selectable()) {
          <label class="pick">
            <input
              type="checkbox"
              [checked]="selected()"
              (change)="onSelect($event)"
              [attr.aria-label]="'Select ' + command().title"
            />
          </label>
        }
        <h2 [id]="titleId()">{{ command().title }}</h2>
        <div class="actions">
          <button
            type="button"
            class="btn btn-ghost btn-icon star"
            [class.on]="command().favorite"
            [attr.aria-pressed]="command().favorite"
            [attr.aria-label]="'Favorite: ' + command().title"
            (click)="toggleFavorite.emit()"
          >
            <app-icon name="star" [filled]="command().favorite" />
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-icon"
            [attr.aria-label]="'Edit ' + command().title"
            (click)="edit.emit()"
          >
            <app-icon name="edit" />
          </button>
          <button
            type="button"
            class="btn btn-icon btn-ghost-danger"
            [attr.aria-label]="'Delete ' + command().title"
            (click)="remove.emit()"
          >
            <app-icon name="trash" />
          </button>
          <button
            type="button"
            class="btn copy"
            [class.btn-success]="copied()"
            [class.btn-outline]="!copied()"
            [attr.aria-label]="copyLabel() + ': ' + command().title"
            (click)="copy.emit()"
          >
            <app-icon [name]="copied() ? 'check' : 'copy'" [size]="16" />
            <span class="copy-text">{{ copyLabel() }}</span>
          </button>
        </div>
      </div>
      <pre
        class="code-block"
        tabindex="0"
        [attr.aria-label]="'Command: ' + command().title"
      ><code>{{ command().command }}</code></pre>
      <div class="meta">
        @if (command().tags.length) {
          <ul class="tags" aria-label="Tags">
            @for (tag of command().tags; track tag) {
              <li class="tag-pill">{{ tag }}</li>
            }
          </ul>
        }
        <p class="usage">{{ usage() }}</p>
      </div>
    </article>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .command {
      display: grid;
      gap: 12px;
      padding: 16px 18px;
    }
    .command.selected {
      border-color: var(--accent);
      box-shadow: 0 0 0 1px var(--accent);
    }
    .pick {
      display: inline-flex;
      flex: none;
      width: 44px;
      height: 44px;
      align-items: center;
      justify-content: center;
      margin: -6px 0 -6px -10px;
      cursor: pointer;
    }
    .pick input {
      width: 20px;
      height: 20px;
      margin: 0;
      accent-color: var(--accent-bg);
      cursor: pointer;
    }
    .top {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    h2 {
      flex: 1;
      min-width: 0;
      font-family: var(--font-body);
      font-size: 17px;
      font-weight: 600;
      letter-spacing: 0;
    }
    .actions {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .star.on {
      color: var(--favorite);
    }
    .copy {
      min-width: 92px;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .tags {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .usage {
      color: var(--muted);
      font-size: 14px;
    }
    @media (max-width: 640px) {
      .copy {
        min-width: 44px;
        padding: 0;
        width: 44px;
      }
      .copy-text {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }
    }
  `,
})
export class CommandCard {
  readonly command = input.required<Command>();
  readonly copied = input(false);

  readonly copy = output<void>();
  readonly edit = output<void>();
  readonly toggleFavorite = output<void>();
  readonly remove = output<void>();

  /** Selection mode for bulk delete: shows a checkbox on the card. */
  readonly selectable = input(false);
  readonly selected = input(false);
  readonly selectedChange = output<boolean>();

  protected readonly titleId = computed(() => `cmd-${this.command().id}`);

  protected onSelect(event: Event): void {
    this.selectedChange.emit((event.target as HTMLInputElement).checked);
  }
  protected readonly placeholderCount = computed(() => this.command().placeholders?.length ?? 0);
  protected readonly copyLabel = computed(() => {
    if (this.copied()) return 'Copied';
    return this.placeholderCount() ? 'Fill and copy' : 'Copy';
  });
  protected readonly usage = computed(() => {
    const n = this.placeholderCount();
    const parts = n ? [`${n} placeholder${n === 1 ? '' : 's'}`] : [];
    parts.push(`used ${this.command().usageCount}×`);
    return parts.join(' · ');
  });
}
