import {
  Component,
  DOCUMENT,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormValueControl } from '@angular/forms/signals';
import { Icon } from '../icon/icon';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
}

/** Keep in sync with the `.option` and `.listbox` styles below. */
const OPTION_HEIGHT = 44;
const LIST_PADDING = 12;
const MAX_LIST_HEIGHT = 320;
const GAP = 6;

interface ListPosition {
  left: number;
  width: number;
  top: number | null;
  bottom: number | null;
}

let nextId = 0;

/**
 * A styled single-select that works with Signal Forms (`[formField]`).
 * Follows the WAI-ARIA "select-only combobox" pattern: focus stays on the button, the active
 * option is announced through `aria-activedescendant`.
 * Keys: ↓/↑/Enter/Space open; ↑/↓/Home/End move; Enter/Space choose; Esc closes; typing a
 * letter jumps to the next matching option.
 * The list is `position: fixed`, so it isn't clipped by a scrolling dialog, and it opens upwards
 * when there isn't room below.
 */
@Component({
  selector: 'app-select',
  imports: [Icon],
  host: {
    '(window:resize)': 'close()',
  },
  template: `
    <button
      #trigger
      type="button"
      class="input trigger"
      role="combobox"
      aria-haspopup="listbox"
      [id]="inputId()"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="listId"
      [attr.aria-activedescendant]="open() ? optionId(activeIndex()) : null"
      [attr.aria-invalid]="invalid() ? 'true' : null"
      [disabled]="disabled()"
      (click)="toggle()"
      (keydown)="onKeydown($event)"
      (blur)="onBlur()"
    >
      <span class="value">{{ selectedLabel() }}</span>
      <app-icon name="chevron" [size]="16" class="chevron" [class.up]="open()" />
    </button>

    @if (open()) {
      <ul
        class="listbox"
        role="listbox"
        [id]="listId"
        [attr.aria-labelledby]="inputId()"
        [style.left.px]="position().left"
        [style.width.px]="position().width"
        [style.top.px]="position().top"
        [style.bottom.px]="position().bottom"
        (mousedown)="$event.preventDefault()"
      >
        @for (option of options(); track option.value; let i = $index) {
          <li
            role="option"
            class="option"
            [id]="optionId(i)"
            [class.active]="i === activeIndex()"
            [attr.aria-selected]="option.value === value()"
            (click)="choose(i)"
            (mousemove)="activeIndex.set(i)"
          >
            <span>{{ option.label }}</span>
            @if (option.value === value()) {
              <app-icon name="check" [size]="16" class="tick" />
            }
          </li>
        }
      </ul>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .trigger {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      text-align: left;
      cursor: pointer;
    }
    .trigger:hover:not(:disabled) {
      border-color: var(--accent);
    }
    .trigger[aria-expanded='true'] {
      border-color: var(--accent);
    }
    .trigger:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }
    .value {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .chevron {
      flex: none;
      color: var(--muted);
      transform: rotate(90deg);
      transition: transform 120ms ease;
    }
    .chevron.up {
      transform: rotate(-90deg);
    }
    .listbox {
      position: fixed;
      z-index: 60;
      max-height: 320px;
      margin: 0;
      padding: 6px;
      overflow-y: auto;
      list-style: none;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: var(--surface);
      box-shadow: 0 12px 32px rgb(14 17 22 / 22%);
    }
    .option {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      min-height: 44px;
      padding: 0 12px;
      border-radius: 8px;
      color: var(--body);
      font-size: 15px;
      cursor: pointer;
    }
    .option.active {
      background: var(--accent-soft);
      color: var(--ink);
    }
    .option[aria-selected='true'] {
      color: var(--ink);
      font-weight: 600;
    }
    .tick {
      color: var(--accent);
    }
    @media (prefers-reduced-motion: reduce) {
      .chevron {
        transition: none;
      }
    }
  `,
})
export class Select<T extends string = string> implements FormValueControl<T> {
  readonly #document = inject(DOCUMENT);
  readonly #destroyRef = inject(DestroyRef);

  /** Bound by `[formField]`, or used directly with `[(value)]`. */
  readonly value = model.required<T>();
  readonly disabled = input(false);
  readonly invalid = input(false);
  readonly touch = output<void>();

  readonly options = input.required<readonly SelectOption<T>[]>();
  /** Id for the button, so a `<label for>` names it. */
  readonly inputId = input.required<string>();

  protected readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');

  protected readonly open = signal(false);
  protected readonly activeIndex = signal(0);
  protected readonly position = signal<ListPosition>({ left: 0, width: 0, top: 0, bottom: null });
  protected readonly selectedIndex = computed(() =>
    Math.max(
      0,
      this.options().findIndex((o) => o.value === this.value()),
    ),
  );
  protected readonly selectedLabel = computed(
    () => this.options().find((o) => o.value === this.value())?.label ?? '',
  );

  protected readonly listId = `select-list-${nextId++}`;
  readonly #onScroll = (event: Event) => {
    // Scrolling the list itself is fine; scrolling the page or dialog would detach it.
    if (!(event.target instanceof Node && this.#listContains(event.target))) this.close();
  };

  constructor() {
    this.#destroyRef.onDestroy(() => this.#stopWatchingScroll());
  }

  focus(options?: FocusOptions): void {
    this.trigger().nativeElement.focus(options);
  }

  protected optionId(index: number): string {
    return `${this.listId}-${index}`;
  }

  protected toggle(): void {
    if (this.open()) this.close();
    else this.#openAt(this.selectedIndex());
  }

  close(): void {
    if (!this.open()) return;
    this.open.set(false);
    this.#stopWatchingScroll();
  }

  protected choose(index: number): void {
    const option = this.options()[index];
    if (option) this.value.set(option.value);
    this.close();
  }

  protected onBlur(): void {
    this.close();
    this.touch.emit();
  }

  protected onKeydown(event: KeyboardEvent): void {
    const last = this.options().length - 1;
    const isOpen = this.open();

    if (!isOpen) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        this.#openAt(this.selectedIndex());
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        this.#openAt(event.key === 'Home' ? 0 : last);
      } else if (this.#isTypeahead(event)) {
        this.#openAt(this.#match(event.key, this.selectedIndex()));
      }
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.#moveTo(Math.min(this.activeIndex() + 1, last));
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (event.altKey) this.choose(this.activeIndex());
        else this.#moveTo(Math.max(this.activeIndex() - 1, 0));
        break;
      case 'Home':
        event.preventDefault();
        this.#moveTo(0);
        break;
      case 'End':
        event.preventDefault();
        this.#moveTo(last);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        this.choose(this.activeIndex());
        break;
      case 'Escape':
        // Close only the list, not a dialog the select sits in.
        event.preventDefault();
        event.stopPropagation();
        this.close();
        break;
      case 'Tab':
        this.close();
        break;
      default:
        if (this.#isTypeahead(event)) this.#moveTo(this.#match(event.key, this.activeIndex()));
    }
  }

  #openAt(index: number): void {
    this.position.set(this.#measure());
    this.activeIndex.set(index);
    this.open.set(true);
    this.#document.addEventListener('scroll', this.#onScroll, true);
  }

  #moveTo(index: number): void {
    this.activeIndex.set(index);
    this.#document.getElementById(this.optionId(index))?.scrollIntoView({ block: 'nearest' });
  }

  #measure(): ListPosition {
    const rect = this.trigger().nativeElement.getBoundingClientRect();
    const viewportHeight = this.#document.defaultView?.innerHeight ?? 0;
    const listHeight = Math.min(
      this.options().length * OPTION_HEIGHT + LIST_PADDING,
      MAX_LIST_HEIGHT,
    );
    const spaceBelow = viewportHeight - rect.bottom;
    const above = spaceBelow < listHeight + GAP && rect.top > spaceBelow;
    return {
      left: rect.left,
      width: rect.width,
      top: above ? null : rect.bottom + GAP,
      bottom: above ? viewportHeight - rect.top + GAP : null,
    };
  }

  #isTypeahead(event: KeyboardEvent): boolean {
    return event.key.length === 1 && /\S/.test(event.key) && !event.ctrlKey && !event.metaKey;
  }

  /** Next option after `from` whose label starts with `key`, wrapping around. */
  #match(key: string, from: number): number {
    const options = this.options();
    const needle = key.toLowerCase();
    for (let step = 1; step <= options.length; step++) {
      const index = (from + step) % options.length;
      if (options[index]?.label.toLowerCase().startsWith(needle)) return index;
    }
    return from;
  }

  #listContains(node: Node): boolean {
    return !!this.#document.getElementById(this.listId)?.contains(node);
  }

  #stopWatchingScroll(): void {
    this.#document.removeEventListener('scroll', this.#onScroll, true);
  }
}
