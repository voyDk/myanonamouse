/// <reference types='vitest' />
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import { nxCopyAssetsPlugin } from '@nx/vite/plugins/nx-copy-assets.plugin';

const execFileAsync = promisify(execFile);

const workspaceRoot = resolve(import.meta.dirname, '..');
const mamScriptPath = resolve(workspaceRoot, 'src/mam-bonus-manager.mjs');
const snapshotCacheTtlMs = 5 * 60 * 1000;

let cachedSnapshot: { value: unknown; at: number } | null = null;
let inFlightSnapshot: Promise<unknown> | null = null;

const parseJsonOutput = (value: string): unknown => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Snapshot command returned empty output.');
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const lines = trimmed.split('\n').map((line) => line.trim()).filter(Boolean);
    const candidate = lines[lines.length - 1];
    return JSON.parse(candidate);
  }
};

const requestLiveSnapshot = async (): Promise<unknown> => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [mamScriptPath, '--snapshot', '--json'], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      MAM_APPLY: 'false',
    },
    maxBuffer: 8 * 1024 * 1024,
  });

  if (stderr.trim()) {
    try {
      const parsed = JSON.parse(stderr.trim()) as { error?: string };
      if (parsed.error) {
        throw new Error(parsed.error);
      }
    } catch {
      // Ignore non-json stderr noise from the child process.
    }
  }

  return parseJsonOutput(stdout);
};

const getSnapshotWithCache = async (forceRefresh: boolean): Promise<unknown> => {
  const now = Date.now();

  if (!forceRefresh && cachedSnapshot && now - cachedSnapshot.at < snapshotCacheTtlMs) {
    return cachedSnapshot.value;
  }

  if (inFlightSnapshot) {
    return inFlightSnapshot;
  }

  inFlightSnapshot = requestLiveSnapshot()
    .then((snapshot) => {
      cachedSnapshot = { value: snapshot, at: Date.now() };
      return snapshot;
    })
    .finally(() => {
      inFlightSnapshot = null;
    });

  return inFlightSnapshot;
};

const liveSnapshotApiPlugin = (): Plugin => {
  const middleware = async (req: { method?: string; url?: string }, res: { statusCode: number; setHeader: (name: string, value: string) => void; end: (chunk: string) => void }, next: () => void): Promise<void> => {
    if (!req.url?.startsWith('/api/snapshot')) {
      next();
      return;
    }

    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    try {
      const requestUrl = new URL(req.url, 'http://localhost');
      const forceRefresh = requestUrl.searchParams.get('refresh') === '1';
      const snapshot = await getSnapshotWithCache(forceRefresh);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(snapshot));
    } catch (error) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : 'Failed to fetch live snapshot.',
        }),
      );
    }
  };

  return {
    name: 'mam-live-snapshot-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void middleware(req, res, next);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        void middleware(req, res, next);
      });
    },
  };
};

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../node_modules/.vite/web',
  server: {
    port: 4200,
    host: 'localhost',
  },
  preview: {
    port: 4200,
    host: 'localhost',
  },
  plugins: [react(), nxViteTsPaths(), nxCopyAssetsPlugin(['*.md']), liveSnapshotApiPlugin()],
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  test: {
    name: 'web',
    watch: false,
    globals: true,
    environment: 'jsdom',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../coverage/web',
      provider: 'v8' as const,
    },
  },
}));
