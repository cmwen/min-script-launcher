import { chmod, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  defaultScriptDirectories,
  discoverScripts,
  findScript,
  formatScriptCommand,
  metadataAuthoringGuide,
  resolveScriptDirectories,
  SCRIPT_DIRS_ENV,
  searchScripts,
} from '../src/index.js';

async function makeExecutableScript(
  directory: string,
  name: string,
  content: string
): Promise<string> {
  const scriptPath = join(directory, name);
  await writeFile(scriptPath, content, 'utf8');
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

describe('script discovery', () => {
  it('uses ~/bin and ~/.local/bin by default', () => {
    expect(defaultScriptDirectories('/home/test')).toEqual([
      '/home/test/bin',
      '/home/test/.local/bin',
    ]);
  });

  it('resolves custom directories from env', () => {
    expect(
      resolveScriptDirectories({
        env: { [SCRIPT_DIRS_ENV]: '~/scripts:/opt/tools' },
        homeDir: '/home/test',
      })
    ).toEqual(['/home/test/scripts', '/opt/tools']);
  });

  it('discovers executable scripts and parses msl metadata', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'msl-'));
    const scriptPath = await makeExecutableScript(
      directory,
      'git-cleanup',
      [
        '#!/usr/bin/env bash',
        '# msl:name Git cleanup',
        '# msl:description Remove merged branches from the current repo.',
        '# msl:usage git-cleanup [--dry-run]',
        '# msl:tags git, cleanup repo',
        '# msl:alias prune-branches',
        '# msl:example git-cleanup --dry-run',
        'echo ok',
      ].join('\n')
    );

    const result = await discoverScripts({ directories: [directory] });

    expect(result.warnings).toEqual([]);
    expect(result.scripts).toHaveLength(1);
    expect(result.scripts[0]).toMatchObject({
      commandName: 'git-cleanup',
      path: scriptPath,
      metadata: {
        name: 'Git cleanup',
        description: 'Remove merged branches from the current repo.',
        usage: 'git-cleanup [--dry-run]',
        tags: ['git', 'cleanup', 'repo'],
        aliases: ['prune-branches'],
        examples: ['git-cleanup --dry-run'],
      },
    });
  });

  it('falls back to useful comments when metadata is missing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'msl-'));
    await makeExecutableScript(
      directory,
      'explain-disk',
      [
        '#!/usr/bin/env node',
        '// Summarize large files in the current project.',
        'console.log("ok");',
      ].join('\n')
    );

    const result = await discoverScripts({ directories: [directory] });

    expect(result.scripts[0].metadata.description).toBe(
      'Summarize large files in the current project.'
    );
    expect(searchScripts(result.scripts, 'large files')[0].entry.commandName).toBe('explain-disk');
  });

  it('skips broken symlinks and returns a warning', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'msl-'));
    await symlink(join(directory, 'missing-target'), join(directory, 'broken-link'));

    const result = await discoverScripts({ directories: [directory] });

    expect(result.scripts).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].path).toContain('broken-link');
    expect(result.warnings[0].reason).toContain('Broken symlink');
  });

  it('finds scripts by command name, display name, alias, and formats commands', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'msl-'));
    await makeExecutableScript(
      directory,
      'repo-status',
      ['#!/usr/bin/env bash', '# msl:name Repo Status', '# msl:alias rs', 'pwd'].join('\n')
    );
    const result = await discoverScripts({ directories: [directory] });

    expect(findScript(result.scripts, 'repo-status')?.commandName).toBe('repo-status');
    expect(findScript(result.scripts, 'Repo Status')?.commandName).toBe('repo-status');
    expect(findScript(result.scripts, 'rs')?.commandName).toBe('repo-status');
    expect(formatScriptCommand(result.scripts[0], ['--name', 'two words'])).toContain(
      "'two words'"
    );
  });

  it('provides authoring guidance for coding agents', () => {
    expect(metadataAuthoringGuide('repo-status')).toContain('msl:usage repo-status');
  });
});
