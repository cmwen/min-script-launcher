import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from '../src/server.js';

describe('Web Server', () => {
  it('should return health check', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });

  it('should search scripts without executing them', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'msl-web-'));
    const scriptPath = join(directory, 'repo-report');
    await writeFile(
      scriptPath,
      [
        '#!/usr/bin/env bash',
        '# msl:description Summarize repository health',
        'echo should-not-run',
      ].join('\n'),
      'utf8'
    );
    await chmod(scriptPath, 0o755);

    const response = await request(app).get('/api/scripts').query({ q: 'health', dir: directory });
    expect(response.status).toBe(200);
    expect(response.body.scripts).toHaveLength(1);
    expect(response.body.scripts[0].commandName).toBe('repo-report');
  });
});
