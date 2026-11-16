import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SeoService } from '../../../core/seo/seo.service';
import { SITE_URL } from '../../../core/site.config';
import { Icon, IconName } from '../../../shared/icon/icon';
import { GithubMark } from '../../../shared/github-mark/github-mark';
import { SiteFooter } from '../../../shared/site-footer/site-footer';
import { SiteHeader } from '../site-header/site-header';

interface Feature {
  icon: IconName;
  title: string;
  body: string;
}

interface Faq {
  question: string;
  answer: string;
}

@Component({
  selector: 'app-home-page',
  imports: [RouterLink, SiteHeader, SiteFooter, Icon, GithubMark],
  templateUrl: './home-page.html',
  styleUrl: './home-page.scss',
})
export default class HomePage {
  protected readonly features: readonly Feature[] = [
    {
      icon: 'terminal',
      title: 'Stored in your gist',
      body: 'Your commands live in one secret gist on your own GitHub account, as plain JSON you can read.',
    },
    {
      icon: 'copy',
      title: 'Copy with placeholders',
      body: 'Write {{host}} or {{port}} once. Fill in the values when you copy — they’re never saved.',
    },
    {
      icon: 'warning',
      title: 'Secret check before save',
      body: 'API keys, tokens and passwords are caught before they reach your gist, with a one-click fix.',
    },
    {
      icon: 'lock',
      title: 'Optional encryption (coming soon)',
      body: 'Lock the vault with a passphrase so anyone with the gist link sees only ciphertext.',
    },
    {
      icon: 'keyboard',
      title: 'Keyboard first',
      body: 'Press / to search, n for a new command, Enter to copy. Your hands stay on the keys.',
    },
    {
      icon: 'download',
      title: 'Import and export',
      body: 'Bring commands in from JSON and take everything out again whenever you like.',
    },
  ];

  protected readonly faqs: readonly Faq[] = [
    {
      question: 'What can GistVault access?',
      answer:
        'Your gists, and nothing else. Gist access covers all of your gists — GitHub can’t limit it to one — but GistVault only ever writes to its own vault gist. It can’t see your repositories or email address.',
    },
    {
      question: 'Do I need a personal access token?',
      answer:
        'No. Sign in with GitHub is the easiest way. A token is an Advanced option for people who want their browser to talk to GitHub directly, with nothing passing through our sign-in function.',
    },
    {
      question: 'What happens if I edit on two devices?',
      answer:
        'Before every save GistVault fetches the latest vault and merges changes per command. If the same command changed in both places, the newer one wins and the other is kept as a “conflicted copy”.',
    },
    {
      question: 'Does it cost anything?',
      answer:
        'No. GistVault is free and open source, and your data lives in your own GitHub account. There is no database to pay for.',
    },
  ];

  constructor() {
    inject(SeoService).set({
      title: 'GistVault — save the commands you look up twice',
      description:
        'Free, open-source command vault. Save, tag and copy shell commands in a secret gist on your own GitHub account. No database, no tracking.',
      path: '/',
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'GistVault',
        url: SITE_URL,
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Web',
        offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD' },
      },
    });
  }
}
