/**
 * Public URLs for the project, in one place.
 *
 * SITE_URL must match the production domain Vercel gives the project (or your custom domain).
 * It is used for canonical links, Open Graph tags and the vault gist's README, and the build
 * (scripts/generate-seo-files.mjs) uses it for robots.txt and sitemap.xml. The build prints a
 * warning on Vercel if it differs from the project's production domain.
 */
export const SITE_URL = 'https://gistvault.vercel.app';

export const REPO_URL = 'https://github.com/Joshua-T-J/cmdvault';
export const ISSUES_URL = `${REPO_URL}/issues/new/choose`;
export const SECURITY_ADVISORY_URL = `${REPO_URL}/security/advisories/new`;
export const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;

declare const GV_SIGN_IN: boolean | undefined;

/**
 * Build-time switch for Sign in with GitHub, set by `define` in angular.json.
 * Set it to false when hosting without the Vercel function (for example on a plain static
 * host), so the app goes straight to the personal access token path without probing /api.
 */
export const SIGN_IN_ENABLED: boolean = typeof GV_SIGN_IN === 'undefined' ? true : GV_SIGN_IN;
