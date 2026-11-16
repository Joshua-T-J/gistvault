import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import {
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
  withViewTransitions,
} from '@angular/router';
import { routes } from './app.routes';
import { AUTH_STRATEGY } from './core/auth/auth-strategy';
import { ActiveAuthStrategy } from './core/auth/active-auth.strategy';
import { BffAuthStrategy } from './core/auth/bff-auth.strategy';
import { PatAuthStrategy } from './core/auth/pat-auth.strategy';
import {
  apiVersionInterceptor,
  authInterceptor,
  errorInterceptor,
  rateLimitInterceptor,
} from './core/http/interceptors';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withViewTransitions(),
      withInMemoryScrolling({ anchorScrolling: 'enabled', scrollPositionRestoration: 'enabled' }),
    ),
    provideHttpClient(
      withFetch(),
      // Order matters: errorInterceptor sits outside auth/rate-limit so they see raw responses.
      withInterceptors([
        apiVersionInterceptor,
        errorInterceptor,
        authInterceptor,
        rateLimitInterceptor,
      ]),
    ),
    // Sign in with GitHub (BFF cookie) and the Advanced personal-access-token path live side by
    // side; ActiveAuthStrategy forwards to whichever one the user signed in with.
    PatAuthStrategy,
    BffAuthStrategy,
    ActiveAuthStrategy,
    { provide: AUTH_STRATEGY, useExisting: ActiveAuthStrategy },
  ],
};
