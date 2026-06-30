#!/usr/bin/env node

import { spawn } from 'node:child_process';
import {
  type DiscoverScriptsOptions,
  discoverScripts,
  findScript,
  formatScriptCommand,
  metadataAuthoringGuide,
  type ScriptEntry,
  searchScripts,
} from '@min-script-launcher/core';
import { Command, Option } from 'commander';
import { startMcpMode } from './modes/mcp.js';
import { startWebMode } from './modes/web.js';
import { renderScriptPicker } from './tui.js';

const VERSION = '0.1.0';

type GlobalOptions = {
  dir?: string[];
  includeNonExecutable?: boolean;
};

const program = new Command();

program
  .name('msl')
  .description('Find and run agent-generated scripts from ~/bin, ~/.local/bin, or custom folders')
  .version(VERSION)
  .addOption(
    new Option(
      '-d, --dir <path>',
      'Script directory to scan. Repeatable. Defaults to ~/bin and ~/.local/bin'
    )
      .argParser((value, previous: string[] = []) => [...previous, value])
      .default([])
  )
  .option('--include-non-executable', 'Include non-executable files in search results', false)
  .action(async () => {
    await openTui(program.opts<GlobalOptions>());
  });

program
  .command('list')
  .description('List discovered scripts')
  .option('--json', 'Print JSON')
  .action(async (options: { json?: boolean }) => {
    const discovery = await loadScripts(program.opts<GlobalOptions>());
    if (options.json) {
      console.log(JSON.stringify(discovery.scripts, null, 2));
      return;
    }

    printWarnings(discovery.warnings);
    printScripts(discovery.scripts);
  });

program
  .command('search')
  .description('Search discovered scripts')
  .argument('[query...]', 'Search text')
  .option('--json', 'Print JSON')
  .action(async (queryParts: string[], options: { json?: boolean }) => {
    const query = queryParts.join(' ');
    const discovery = await loadScripts(program.opts<GlobalOptions>());
    const results = searchScripts(discovery.scripts, query);

    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    printWarnings(discovery.warnings);
    printScripts(results.map((result) => result.entry));
  });

program
  .command('run')
  .description('Run a script by command name, display name, alias, or path')
  .argument('<script>', 'Script identifier')
  .argument('[args...]', 'Arguments passed to the script')
  .option('--dry-run', 'Print the command without executing it', false)
  .action(async (identifier: string, args: string[], options: { dryRun?: boolean }) => {
    const discovery = await loadScripts(program.opts<GlobalOptions>());
    const script = findScript(discovery.scripts, identifier);

    if (!script) {
      printWarnings(discovery.warnings);
      console.error(`No script found for "${identifier}". Try "msl search ${identifier}".`);
      process.exitCode = 1;
      return;
    }

    if (options.dryRun) {
      console.log(formatScriptCommand(script, args));
      return;
    }

    await executeScript(script, args);
  });

program
  .command('guide')
  .description('Print metadata guidance for coding agents that generate scripts')
  .argument('[command-name]', 'Example command name', 'your-script')
  .action((commandName: string) => {
    console.log(metadataAuthoringGuide(commandName));
  });

program
  .command('mcp')
  .description('Start the MCP server for script discovery and authoring guidance')
  .action(async () => {
    await startMcpMode();
  });

program
  .command('web')
  .description('Start the search-only web server')
  .option('-p, --port <number>', 'Port to run the web server on', '3000')
  .action(async (options: { port: string }) => {
    await startWebMode(Number.parseInt(options.port, 10));
  });

program.parseAsync().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function openTui(options: GlobalOptions): Promise<void> {
  const discovery = await loadScripts(options);

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    printWarnings(discovery.warnings);
    printScripts(discovery.scripts);
    return;
  }

  let selected: ScriptEntry | undefined;
  await renderScriptPicker({
    scripts: discovery.scripts,
    warnings: discovery.warnings,
    onSelect: (script) => {
      selected = script;
    },
  });

  if (selected) {
    await executeScript(selected, []);
  }
}

async function loadScripts(options: GlobalOptions) {
  const discoverOptions: DiscoverScriptsOptions = {
    directories: options.dir,
    includeNonExecutable: options.includeNonExecutable,
  };

  return discoverScripts(discoverOptions);
}

async function executeScript(script: ScriptEntry, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(script.resolvedPath, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }

      process.exitCode = code ?? 1;
      resolve();
    });
  });
}

function printScripts(scripts: ScriptEntry[]): void {
  if (scripts.length === 0) {
    console.log('No scripts found.');
    return;
  }

  for (const script of scripts) {
    const description = script.metadata.description ? ` - ${script.metadata.description}` : '';
    console.log(`${script.commandName}${description}`);
    console.log(`  ${script.metadata.usage ?? script.path}`);
  }
}

function printWarnings(warnings: { path: string; reason: string }[]): void {
  for (const warning of warnings) {
    console.error(`Warning: ${warning.path}: ${warning.reason}`);
  }
}
