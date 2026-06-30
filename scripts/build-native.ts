import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const entrypoint = join(root, 'packages/cli/src/index.ts');
const nativeDir = join(root, 'dist/native');
const releaseDir = join(root, 'dist/release');

const targets = [
  { target: 'bun-linux-x64', name: 'msl-linux-x64' },
  { target: 'bun-linux-arm64', name: 'msl-linux-arm64' },
  { target: 'bun-darwin-x64', name: 'msl-darwin-x64' },
  { target: 'bun-darwin-arm64', name: 'msl-darwin-arm64' },
];

await rm(join(root, 'dist'), { recursive: true, force: true });
await mkdir(nativeDir, { recursive: true });
await mkdir(releaseDir, { recursive: true });

const checksums: string[] = [];

for (const { target, name } of targets) {
  const output = join(nativeDir, name);
  await run('bun', ['build', entrypoint, '--compile', `--target=${target}`, '--outfile', output]);
  await chmod(output, 0o755);

  const archive = await archiveExecutable(output, name);
  checksums.push(`${await sha256(archive)}  ${basename(archive)}`);
}

const checksumPath = join(releaseDir, 'SHA256SUMS');
await writeFile(checksumPath, `${checksums.join('\n')}\n`, 'utf8');
await chmod(checksumPath, 0o644);
console.log(`Native release bundles written to ${releaseDir}`);

async function archiveExecutable(executablePath: string, name: string): Promise<string> {
  const stagingDir = join(nativeDir, `${name}-staging`);
  const archivePath = join(releaseDir, `${name}.tar.gz`);

  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });
  await cp(executablePath, join(stagingDir, 'msl'));
  await cp(join(root, 'README.md'), join(stagingDir, 'README.md'));
  await cp(join(root, 'LICENSE'), join(stagingDir, 'LICENSE'));
  await run('tar', ['-czf', archivePath, '-C', stagingDir, '.']);
  await chmod(archivePath, 0o644);

  return archivePath;
}

async function sha256(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  hash.update(await readFile(filePath));
  return hash.digest('hex');
}

async function run(command: string, args: string[]): Promise<void> {
  console.log(`$ ${command} ${args.join(' ')}`);
  const { stdout, stderr } = await exec(command, args, { cwd: root, maxBuffer: 1024 * 1024 * 20 });
  if (stdout) {
    process.stdout.write(stdout);
  }
  if (stderr) {
    process.stderr.write(stderr);
  }
}
