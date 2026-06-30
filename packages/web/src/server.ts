#!/usr/bin/env node

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverScripts, searchScripts } from '@min-script-launcher/core';
import express, { type Express } from 'express';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app: Express = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/scripts', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q : '';
  const dirs = typeof req.query.dir === 'string' ? [req.query.dir] : undefined;
  const discovery = await discoverScripts({ directories: dirs });
  const scripts = query
    ? searchScripts(discovery.scripts, query).map((result) => result.entry)
    : discovery.scripts;

  res.json({ scripts, warnings: discovery.warnings });
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(join(__dirname, 'client')));

  app.use((_req, res) => {
    res.sendFile(join(__dirname, 'client', 'index.html'));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  app.listen(port, () => {
    console.log(`min-script-launcher web search running at http://localhost:${port}`);
  });
}

export default app;
