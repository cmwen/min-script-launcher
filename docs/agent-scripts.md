# Agent-Generated Script Guidelines

Use this guide when a coding agent creates a script intended for `min-script-launcher`.

## Placement

Save generated scripts in one of the user-configured catalog directories. The defaults are:

- `~/bin`
- `~/.local/bin`

Scripts may also be managed through dotfiles and symlinked into those folders. Broken symlinks are ignored by the launcher and reported as warnings.

## Runtime Context

Generated scripts should assume they are executed from the user's current working directory, not from the directory where the script file lives.

Good scripts:

- Use `pwd` or process cwd as the target project/context.
- Accept explicit paths when useful.
- Avoid `cd "$(dirname "$0")"` unless the script truly needs bundled assets.

## Metadata

Add metadata comments near the top of every generated script:

```bash
# msl:name Human readable title
# msl:description What the script does and when to use it.
# msl:usage command-name [options] <target>
# msl:tags git, cleanup, repo
# msl:alias short-name
# msl:example command-name --dry-run
```

The launcher also accepts `msl:key: value` if that style is easier for the language or generator.

## Script Quality

Generated scripts should be executable, readable, and conservative:

- Include a shebang.
- Use strict shell settings for shell scripts, such as `set -euo pipefail`.
- Print clear errors.
- Provide `--help` for scripts with options.
- Support `--dry-run` when making filesystem or network changes.
- Avoid hardcoded secrets and machine-specific paths.
