import {
  Component,
  ElementRef,
  OnInit,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { FormField, disabled, form, required, submit } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { InvalidTokenFormatError } from '../../../core/auth/auth-strategy';
import { BffAuthStrategy } from '../../../core/auth/bff-auth.strategy';
import { ConnectStep, SessionService } from '../../../core/auth/session.service';
import { daysUntil } from '../../../core/auth/token-probe';
import { describeError } from '../../../core/github/github-errors';
import { SeoService } from '../../../core/seo/seo.service';
import { GithubMark } from '../../../shared/github-mark/github-mark';
import { Icon } from '../../../shared/icon/icon';
import { Logo } from '../../../shared/logo/logo';
import { SiteFooter } from '../../../shared/site-footer/site-footer';
import { ThemePicker } from '../../../shared/theme-picker/theme-picker';
import { CommandStore } from '../../commands/command.store';
import { SAMPLE_COMMANDS } from '../../commands/sample-commands';
import { TokenHelp } from '../token-help/token-help';

type WizardStep = 1 | 2 | 3;
type CheckState = 'pending' | 'running' | 'done' | 'error';

interface Check {
  id: ConnectStep;
  label: string;
  state: CheckState;
  detail?: string;
}

/** Messages for the `signin` query parameter the sign-in function redirects back with. */
const SIGN_IN_NOTICES: Readonly<Record<string, string>> = {
  denied: 'Sign-in was cancelled on GitHub. Try again, or use a personal access token below.',
  expired: 'That sign-in took too long or was started in another browser. Please try again.',
  failed: 'GitHub sign-in didn’t complete. Please try again.',
  unavailable:
    'Sign in with GitHub isn’t set up on this copy of GistVault. Use a personal access token below.',
};

/** Where Sign in with GitHub returns to, so new users still get the "first command" step. */
const WELCOME_RETURN = '/app/connect?welcome=1';

const INITIAL_CHECKS: readonly Check[] = [
  { id: 'token', label: 'Token is valid', state: 'pending' },
  { id: 'scopes', label: 'Has Gists access', state: 'pending' },
  { id: 'vault', label: 'Looking for your vault gist', state: 'pending' },
];

@Component({
  selector: 'app-connect-page',
  imports: [RouterLink, FormField, GithubMark, Icon, Logo, TokenHelp, SiteFooter, ThemePicker],
  templateUrl: './connect-page.html',
  styleUrl: './connect-page.scss',
})
export default class ConnectPage implements OnInit {
  readonly #session = inject(SessionService);
  readonly #commands = inject(CommandStore);
  readonly #router = inject(Router);
  readonly #bff = inject(BffAuthStrategy);

  /** Query parameters set by the sign-in function's redirect. */
  readonly signin = input<string>();
  readonly welcome = input<string>();

  protected readonly heading = viewChild<ElementRef<HTMLHeadingElement>>('heading');

  protected readonly step = signal<WizardStep>(1);
  protected readonly checks = signal<readonly Check[]>(INITIAL_CHECKS);
  protected readonly verifying = signal(false);
  protected readonly verified = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly warnings = signal<string[]>([]);
  protected readonly addingExamples = signal(false);

  protected readonly signInAvailability = this.#bff.availability;
  protected readonly redirecting = signal(false);
  protected readonly finishingSignIn = signal(false);
  protected readonly existingLogin = computed(() => this.#bff.session()?.login ?? null);
  protected readonly signInError = signal<string | null>(null);
  protected readonly signInNotice = computed(
    () => this.signInError() ?? SIGN_IN_NOTICES[this.signin() ?? ''] ?? null,
  );

  protected readonly model = signal({ token: '', remember: false });
  protected readonly tokenForm = form(this.model, (path) => {
    required(path.token, { message: 'Paste your token to continue.' });
    disabled(path.token, () => this.verified());
    disabled(path.remember, () => this.verified());
  });

  protected readonly tokenError = computed(() => {
    const field = this.tokenForm.token();
    if (this.errorMessage()) return this.errorMessage();
    return field.touched() ? (field.errors()[0]?.message ?? null) : null;
  });

  protected readonly steps = [
    { no: 1 as const, label: 'Connect GitHub' },
    { no: 2 as const, label: 'Paste and verify' },
    { no: 3 as const, label: 'Add your first command' },
  ];

  constructor() {
    inject(SeoService).set({
      title: 'Connect GitHub · GistVault',
      description: 'Connect GistVault to your GitHub account.',
      path: '/app/connect',
      noindex: true,
    });
  }

  async ngOnInit(): Promise<void> {
    if (this.welcome()) {
      await this.#finishGitHubSignIn();
    } else {
      await this.#bff.probe();
    }
  }

  protected async signInWithGitHub(): Promise<void> {
    this.redirecting.set(true);
    await this.#session.signInWithGitHub(WELCOME_RETURN);
  }

  /**
   * Back from GitHub: open (or create) the vault. A vault that already has commands goes
   * straight to /app; an empty one gets the examples step.
   */
  async #finishGitHubSignIn(): Promise<void> {
    this.finishingSignIn.set(true);
    try {
      if (!(await this.#session.resume())) {
        this.signInError.set(SIGN_IN_NOTICES['failed'] ?? null);
      } else if (this.#commands.commands().length > 0) {
        // Returning user with commands already: skip the examples step.
        await this.#router.navigateByUrl('/app', { replaceUrl: true });
      } else {
        this.goTo(3);
      }
    } catch (err) {
      this.signInError.set(describeError(err));
    } finally {
      this.finishingSignIn.set(false);
    }
  }

  protected goTo(step: WizardStep): void {
    this.step.set(step);
    // Move focus to the new step's heading so screen readers announce the change.
    queueMicrotask(() => this.heading()?.nativeElement.focus());
  }

  protected async verify(event?: Event): Promise<void> {
    event?.preventDefault();
    await submit(this.tokenForm, async () => {
      await this.#runProbe();
      return undefined;
    });
  }

  async #runProbe(): Promise<void> {
    const { token, remember } = this.model();
    this.verifying.set(true);
    this.verified.set(false);
    this.errorMessage.set(null);
    this.warnings.set([]);
    this.checks.set(INITIAL_CHECKS);

    try {
      const result = await this.#session.connect(token, remember ? 'session' : 'memory', (p) =>
        this.#setCheck(p.step, p.state, p.detail),
      );
      const { capabilities, createdVault } = result;
      const warnings: string[] = [];
      if (capabilities.extraScopes.length) {
        warnings.push(
          `This classic token also has ${capabilities.extraScopes.join(', ')}. A token with only the gist scope is safer.`,
        );
      }
      if (capabilities.expiresAt) {
        this.#setCheck(
          'scopes',
          'done',
          `expires in ${daysUntil(capabilities.expiresAt, Date.now())} days`,
        );
      } else if (capabilities.tokenKind === 'classic') {
        warnings.push('This token never expires. Consider one that expires in 90 days or less.');
      }
      this.#setCheck('vault', 'done', createdVault ? 'Created a new vault' : 'Found your vault');
      this.warnings.set(warnings);
      this.model.update((m) => ({ ...m, token: '' }));
      this.verified.set(true);
    } catch (err) {
      this.checks.update((list) =>
        list.map((c) => (c.state === 'running' ? { ...c, state: 'error' } : c)),
      );
      this.errorMessage.set(
        err instanceof InvalidTokenFormatError ? err.message : describeError(err),
      );
    } finally {
      this.verifying.set(false);
    }
  }

  protected async addExamples(): Promise<void> {
    this.addingExamples.set(true);
    this.#commands.addMany(SAMPLE_COMMANDS);
    await this.#router.navigateByUrl('/app');
  }

  protected async startEmpty(): Promise<void> {
    await this.#router.navigateByUrl('/app');
  }

  #setCheck(id: ConnectStep, state: CheckState, detail?: string): void {
    this.checks.update((list) =>
      list.map((c) => (c.id === id ? { ...c, state, detail: detail ?? c.detail } : c)),
    );
  }
}
