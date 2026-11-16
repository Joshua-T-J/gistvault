// Runs the Vercel function (api/index.ts) locally on http://localhost:3001 for `ng serve`,
// which proxies /api to it (proxy.conf.json). Reads settings from .env.local.
//
//   npm run dev:api
//
// Production uses Vercel's own runtime; this script only exists for local development.
// esbuild comes with @angular/build, so it needs no extra dependency.
import { existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const PORT = Number(process.env.API_PORT ?? 3001);
const ENV_FILE = '.env.local';

if (existsSync(ENV_FILE)) {
  process.loadEnvFile(ENV_FILE);
} else {
  console.warn(`dev-api: no ${ENV_FILE} found — copy .env.example and fill it in.`);
}

const outDir = join('tmp', 'dev-api');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, 'index.mjs');
await build({
  entryPoints: ['api/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: outFile,
  logLevel: 'warning',
});
const { default: handler } = await import(`${pathToFileURL(outFile).href}?t=${Date.now()}`);

const server = createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) value.forEach((v) => headers.append(name, v));
      else if (value !== undefined) headers.set(name, value);
    }
    // ng serve's proxy forwards to us; report the browser-facing origin like Vercel would.
    const origin = process.env.APP_ORIGIN ?? `http://localhost:${PORT}`;
    const request = new Request(new URL(req.url ?? '/', origin), {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
    });

    const response = await handler.fetch(request);
    const outHeaders = {};
    response.headers.forEach((value, name) => {
      if (name !== 'set-cookie') outHeaders[name] = value;
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) outHeaders['set-cookie'] = cookies;
    res.writeHead(response.status, outHeaders);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    console.error('dev-api:', err);
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end('{"error":"internal"}');
  }
});

server.listen(PORT, () => console.log(`dev-api: listening on http://localhost:${PORT}`));
