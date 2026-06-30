import { constants, type Dirent, type Stats } from 'node:fs';
import { access, lstat, open, readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';

const DEFAULT_READ_BYTES = 24 * 1024;
const DEFAULT_RESULT_LIMIT = 50;

export interface ScriptMetadata {
  name?: string;
  description?: string;
  usage?: string;
  tags: string[];
  aliases: string[];
  examples: string[];
  notes?: string;
}

export interface ScriptEntry {
  id: string;
  commandName: string;
  path: string;
  resolvedPath: string;
  directory: string;
  isSymlink: boolean;
  size: number;
  modifiedAt: Date;
  metadata: ScriptMetadata;
  shebang?: string;
  commentPreview: string[];
  searchableText: string;
}

export interface ScriptWarning {
  path: string;
  reason: string;
}

export interface DiscoveryResult {
  scripts: ScriptEntry[];
  warnings: ScriptWarning[];
}

export interface DiscoverScriptsOptions {
  directories?: string[];
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  includeNonExecutable?: boolean;
  maxReadBytes?: number;
}

export interface ScriptSearchResult {
  entry: ScriptEntry;
  score: number;
}

export interface SearchScriptsOptions {
  limit?: number;
}

export const SCRIPT_DIRS_ENV = 'MSL_SCRIPT_DIRS';

export function defaultScriptDirectories(home = homedir()): string[] {
  return [join(home, 'bin'), join(home, '.local', 'bin')];
}

export function expandHome(input: string, home = homedir()): string {
  if (input === '~') {
    return home;
  }

  if (input.startsWith('~/')) {
    return join(home, input.slice(2));
  }

  return input;
}

export function resolveScriptDirectories(options: DiscoverScriptsOptions = {}): string[] {
  const envValue = options.env?.[SCRIPT_DIRS_ENV] ?? process.env[SCRIPT_DIRS_ENV];
  const configuredDirectories = options.directories?.length
    ? options.directories
    : envValue?.split(':').filter(Boolean);

  const directories = configuredDirectories?.length
    ? configuredDirectories
    : defaultScriptDirectories(options.homeDir);

  return [
    ...new Set(directories.map((directory) => resolve(expandHome(directory, options.homeDir)))),
  ];
}

export async function discoverScripts(
  options: DiscoverScriptsOptions = {}
): Promise<DiscoveryResult> {
  const directories = resolveScriptDirectories(options);
  const scripts: ScriptEntry[] = [];
  const warnings: ScriptWarning[] = [];

  for (const directory of directories) {
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      warnings.push({ path: directory, reason: `Cannot read directory: ${errorMessage(error)}` });
      continue;
    }

    for (const entry of entries) {
      const scriptPath = join(directory, entry.name);
      const discovered = await discoverScript(scriptPath, directory, options);
      if (discovered.warning) {
        warnings.push(discovered.warning);
      }

      if (discovered.entry) {
        scripts.push(discovered.entry);
      }
    }
  }

  scripts.sort(compareScripts);

  return { scripts, warnings };
}

export function searchScripts(
  scripts: ScriptEntry[],
  query: string,
  options: SearchScriptsOptions = {}
): ScriptSearchResult[] {
  const trimmedQuery = query.trim().toLowerCase();
  const limit = options.limit ?? DEFAULT_RESULT_LIMIT;

  if (!trimmedQuery) {
    return scripts.slice(0, limit).map((entry) => ({ entry, score: 0 }));
  }

  const queryTokens = tokenize(trimmedQuery);

  return scripts
    .map((entry) => ({ entry, score: scoreScript(entry, trimmedQuery, queryTokens) }))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || compareScripts(a.entry, b.entry))
    .slice(0, limit);
}

export function findScript(scripts: ScriptEntry[], identifier: string): ScriptEntry | undefined {
  const requested = identifier.toLowerCase();

  return scripts.find((script) => {
    const candidates = [
      script.commandName,
      script.metadata.name,
      ...script.metadata.aliases,
      script.path,
      script.resolvedPath,
    ].filter(Boolean);

    return candidates.some((candidate) => candidate?.toLowerCase() === requested);
  });
}

export function formatScriptCommand(script: ScriptEntry, args: string[] = []): string {
  return [script.path, ...args].map(shellQuote).join(' ');
}

export function metadataAuthoringGuide(commandName = 'your-script'): string {
  return [
    'Add script-launcher metadata near the top of generated scripts.',
    '',
    '# msl:name Human readable title',
    '# msl:description What the script does and when to use it.',
    `# msl:usage ${commandName} [options] <target>`,
    '# msl:tags git, cleanup, repo',
    '# msl:alias short-name',
    `# msl:example ${commandName} --dry-run`,
    '',
    'Keep scripts executable, put them in ~/bin or ~/.local/bin, and make behavior relative to the current working directory unless metadata says otherwise.',
  ].join('\n');
}

async function discoverScript(
  scriptPath: string,
  directory: string,
  options: DiscoverScriptsOptions
): Promise<{ entry?: ScriptEntry; warning?: ScriptWarning }> {
  let linkStat: Stats;
  try {
    linkStat = await lstat(scriptPath);
  } catch (error) {
    return {
      warning: { path: scriptPath, reason: `Cannot inspect entry: ${errorMessage(error)}` },
    };
  }

  let resolvedPath = scriptPath;
  let targetStat = linkStat;
  const isSymlink = linkStat.isSymbolicLink();

  if (isSymlink) {
    try {
      resolvedPath = await realpath(scriptPath);
      targetStat = await stat(resolvedPath);
    } catch (error) {
      return {
        warning: {
          path: scriptPath,
          reason: `Broken symlink or unreadable target: ${errorMessage(error)}`,
        },
      };
    }
  }

  if (!targetStat.isFile()) {
    return {};
  }

  const executable = await isExecutable(scriptPath);
  if (!executable && !options.includeNonExecutable) {
    return {};
  }

  const sourcePreview = await readPreview(resolvedPath, options.maxReadBytes ?? DEFAULT_READ_BYTES);
  const parsed = parseScriptSource(sourcePreview);
  const commandName = basename(scriptPath);
  const metadata = normalizeMetadata(parsed.metadata, commandName, parsed.commentPreview);

  return {
    entry: {
      id: scriptPath,
      commandName,
      path: scriptPath,
      resolvedPath,
      directory,
      isSymlink,
      size: targetStat.size,
      modifiedAt: targetStat.mtime,
      metadata,
      shebang: parsed.shebang,
      commentPreview: parsed.commentPreview,
      searchableText: buildSearchableText(
        scriptPath,
        metadata,
        parsed.commentPreview,
        parsed.shebang
      ),
    },
  };
}

function parseScriptSource(source: string): {
  metadata: Partial<ScriptMetadata>;
  shebang?: string;
  commentPreview: string[];
} {
  const lines = source.split(/\r?\n/).slice(0, 160);
  const state: ScriptParseState = {
    metadata: { tags: [], aliases: [], examples: [] },
    commentPreview: [],
    inMetadataBlock: false,
    sawCode: false,
  };

  for (const rawLine of lines) {
    if (readSourceLine(rawLine, state)) {
      break;
    }
  }

  return {
    metadata: state.metadata,
    shebang: state.shebang,
    commentPreview: state.commentPreview.filter((line, index, all) => line || all[index - 1]),
  };
}

interface ScriptParseState {
  metadata: Partial<ScriptMetadata>;
  shebang?: string;
  commentPreview: string[];
  inMetadataBlock: boolean;
  sawCode: boolean;
}

function readSourceLine(rawLine: string, state: ScriptParseState): boolean {
  const trimmed = rawLine.trim();
  if (!trimmed) {
    return readBlankLine(state);
  }

  if (!state.shebang && trimmed.startsWith('#!')) {
    state.shebang = trimmed;
    return false;
  }

  const comment = stripCommentPrefix(trimmed);
  if (comment === undefined) {
    return readCodeLine(state);
  }

  readCommentLine(comment, state);
  return false;
}

function readBlankLine(state: ScriptParseState): boolean {
  if (state.commentPreview.length > 0 && !state.sawCode) {
    state.commentPreview.push('');
  }

  return false;
}

function readCodeLine(state: ScriptParseState): boolean {
  state.sawCode = true;
  return state.commentPreview.length > 0;
}

function readCommentLine(comment: string, state: ScriptParseState): void {
  const normalizedComment = comment.trim();
  if (!normalizedComment) {
    return;
  }

  const blockMarker = metadataBlockMarker(normalizedComment);
  if (blockMarker !== undefined) {
    state.inMetadataBlock = blockMarker;
    return;
  }

  if (state.commentPreview.length < 24 && !isMetadataLine(normalizedComment)) {
    state.commentPreview.push(normalizedComment);
  }

  const parsed = parseMetadataLine(normalizedComment, state.inMetadataBlock);
  if (parsed) {
    applyMetadata(state.metadata, parsed.key, parsed.value);
  }
}

function metadataBlockMarker(comment: string): boolean | undefined {
  const lowerComment = comment.toLowerCase();
  if (lowerComment === 'script-launcher' || lowerComment === 'min-script-launcher') {
    return true;
  }

  if (lowerComment === '/script-launcher' || lowerComment === 'end-script-launcher') {
    return false;
  }

  return undefined;
}

function parseMetadataLine(
  line: string,
  inMetadataBlock: boolean
): { key: string; value: string } | undefined {
  const prefixed = line.match(
    /^(?:msl|script-launcher)[.:]\s*([a-z][a-z0-9_-]*)(?:\s*[:=]\s*|\s+)(.+)$/i
  );
  if (prefixed) {
    return { key: prefixed[1].toLowerCase(), value: prefixed[2].trim() };
  }

  if (inMetadataBlock) {
    const blockLine = line.match(/^([a-z][a-z0-9_-]*)\s*:\s*(.+)$/i);
    if (blockLine) {
      return { key: blockLine[1].toLowerCase(), value: blockLine[2].trim() };
    }
  }

  return undefined;
}

function applyMetadata(metadata: Partial<ScriptMetadata>, key: string, value: string): void {
  switch (key) {
    case 'name':
    case 'title':
      metadata.name = value;
      break;
    case 'description':
    case 'summary':
      metadata.description = value;
      break;
    case 'usage':
    case 'command':
      metadata.usage = value;
      break;
    case 'tag':
    case 'tags':
      metadata.tags = [...(metadata.tags ?? []), ...splitList(value)];
      break;
    case 'alias':
    case 'aliases':
      metadata.aliases = [...(metadata.aliases ?? []), ...splitList(value)];
      break;
    case 'example':
    case 'examples':
      metadata.examples = [...(metadata.examples ?? []), value];
      break;
    case 'note':
    case 'notes':
      metadata.notes = value;
      break;
  }
}

function normalizeMetadata(
  metadata: Partial<ScriptMetadata>,
  commandName: string,
  commentPreview: string[]
): ScriptMetadata {
  const fallbackDescription = commentPreview.find((line) => line.length > 0);

  return {
    name: metadata.name ?? commandName.replace(extname(commandName), '').replaceAll('-', ' '),
    description: metadata.description ?? fallbackDescription,
    usage: metadata.usage ?? commandName,
    tags: unique(metadata.tags ?? []),
    aliases: unique(metadata.aliases ?? []),
    examples: unique(metadata.examples ?? []),
    notes: metadata.notes,
  };
}

function stripCommentPrefix(line: string): string | undefined {
  const prefixes = ['#', '//', ';', '--', '*'];

  for (const prefix of prefixes) {
    if (line.startsWith(prefix)) {
      return line.slice(prefix.length).trim();
    }
  }

  if (line.startsWith('/*')) {
    return line.slice(2).replace(/\*\/$/, '').trim();
  }

  return undefined;
}

function isMetadataLine(line: string): boolean {
  return /^(?:msl|script-launcher)[.:]/i.test(line);
}

function buildSearchableText(
  scriptPath: string,
  metadata: ScriptMetadata,
  commentPreview: string[],
  shebang?: string
): string {
  return [
    basename(scriptPath),
    scriptPath,
    metadata.name,
    metadata.description,
    metadata.usage,
    metadata.tags.join(' '),
    metadata.aliases.join(' '),
    metadata.examples.join(' '),
    metadata.notes,
    shebang,
    commentPreview.join(' '),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

async function readPreview(scriptPath: string, maxBytes: number): Promise<string> {
  const file = await open(scriptPath, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes);
    const result = await file.read(buffer, 0, maxBytes, 0);
    const slice = buffer.subarray(0, result.bytesRead);

    if (slice.includes(0)) {
      return '';
    }

    return slice.toString('utf8');
  } finally {
    await file.close();
  }
}

async function isExecutable(scriptPath: string): Promise<boolean> {
  try {
    await access(scriptPath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function scoreScript(entry: ScriptEntry, query: string, queryTokens: string[]): number {
  const fields = [
    { value: entry.commandName, weight: 42 },
    { value: entry.metadata.name, weight: 36 },
    { value: entry.metadata.aliases.join(' '), weight: 34 },
    { value: entry.metadata.tags.join(' '), weight: 28 },
    { value: entry.metadata.description, weight: 20 },
    { value: entry.metadata.usage, weight: 16 },
    { value: entry.searchableText, weight: 8 },
    { value: entry.path, weight: 4 },
  ];

  return fields.reduce(
    (score, field) => score + scoreText(field.value ?? '', query, queryTokens, field.weight),
    0
  );
}

function scoreText(value: string, query: string, queryTokens: string[], weight: number): number {
  const text = value.toLowerCase();
  let score = 0;

  if (text === query) {
    score += weight * 4;
  } else if (text.includes(query)) {
    score += weight * 2;
  }

  for (const token of queryTokens) {
    if (text.includes(token)) {
      score += weight;
    }
  }

  return score;
}

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9_.-]+/i)
    .map((token) => token.trim())
    .filter(Boolean);
}

function splitList(input: string): string[] {
  return input
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function compareScripts(a: ScriptEntry, b: ScriptEntry): number {
  return a.commandName.localeCompare(b.commandName);
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(value)) {
    return value;
  }

  return `'${value.replaceAll("'", "'\\''")}'`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export * from './utils.js';
