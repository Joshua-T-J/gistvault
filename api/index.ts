import { createApiHandler } from './_lib/api-handler';

declare const process: { env: Record<string, string | undefined> };

const handle = createApiHandler({
  env: process.env,
  fetch: (input, init) => fetch(input, init),
  now: () => Date.now(),
});

/** Vercel Function (Node.js runtime, Web-standard handler) serving every /api/* route. */
export default {
  fetch(request: Request): Promise<Response> {
    return handle(request);
  },
};
