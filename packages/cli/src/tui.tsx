import {
  formatScriptCommand,
  type ScriptEntry,
  type ScriptWarning,
  searchScripts,
} from '@min-script-launcher/core';
import { Box, render, Text, useApp, useInput } from 'ink';
import { useMemo, useState } from 'react';

interface ScriptPickerProps {
  scripts: ScriptEntry[];
  warnings: ScriptWarning[];
  onSelect: (script: ScriptEntry) => void;
}

export async function renderScriptPicker(props: ScriptPickerProps): Promise<void> {
  const instance = render(<ScriptPicker {...props} />);
  await instance.waitUntilExit();
}

function ScriptPicker({ scripts, warnings, onSelect }: ScriptPickerProps) {
  const { exit } = useApp();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const results = useMemo(
    () => searchScripts(scripts, query, { limit: 10 }).map((result) => result.entry),
    [scripts, query]
  );
  const selected = results[selectedIndex];

  useInput((input, key) => {
    const action = getInputAction(input, key, query, Boolean(selected), results.length);
    if (action === 'exit') {
      exit();
      return;
    }

    if (action === 'select' && selected) {
      onSelect(selected);
      exit();
      return;
    }

    if (action === 'up') {
      setSelectedIndex((index) => Math.max(0, index - 1));
      return;
    }

    if (action === 'down') {
      setSelectedIndex((index) => Math.min(results.length - 1, index + 1));
      return;
    }

    if (action === 'backspace') {
      setQuery((current) => current.slice(0, -1));
      setSelectedIndex(0);
      return;
    }

    if (action === 'text') {
      setQuery((current) => current + input);
      setSelectedIndex(0);
    }
  });

  return (
    <Box flexDirection='column' paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color='cyan'>
          min-script-launcher
        </Text>
        <Text color='gray'> type to search, Enter to run, Esc to quit</Text>
      </Box>

      <Box>
        <Text color='green'>Search </Text>
        <Text>{query || ' '}</Text>
      </Box>

      {warnings.length > 0 && (
        <Box marginTop={1}>
          <Text color='yellow'>
            {warnings.length} warning(s), including {warnings[0].path}
          </Text>
        </Box>
      )}

      <Box marginTop={1} flexDirection='column'>
        {results.length === 0 ? (
          <Text color='gray'>No scripts found.</Text>
        ) : (
          results.map((script, index) => (
            <Text key={script.id} color={index === selectedIndex ? 'cyan' : undefined}>
              {index === selectedIndex ? '>' : ' '} {script.commandName}
              {script.metadata.description ? ` - ${script.metadata.description}` : ''}
            </Text>
          ))
        )}
      </Box>

      {selected && (
        <Box
          marginTop={1}
          borderStyle='single'
          borderColor='gray'
          flexDirection='column'
          paddingX={1}
        >
          <Text bold>{selected.metadata.name ?? selected.commandName}</Text>
          {selected.metadata.description && <Text>{selected.metadata.description}</Text>}
          <Text color='gray'>{selected.path}</Text>
          <Text color='green'>{formatScriptCommand(selected)}</Text>
          {selected.metadata.tags.length > 0 && (
            <Text color='gray'>tags: {selected.metadata.tags.join(', ')}</Text>
          )}
          {selected.metadata.examples.slice(0, 2).map((example) => (
            <Text key={example} color='gray'>
              example: {example}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

function getInputAction(
  input: string,
  key: Parameters<Parameters<typeof useInput>[0]>[1],
  query: string,
  hasSelection: boolean,
  resultCount: number
): 'backspace' | 'down' | 'exit' | 'none' | 'select' | 'text' | 'up' {
  if ((key.ctrl && input === 'c') || key.escape || (input === 'q' && !query)) {
    return 'exit';
  }

  if (key.return && hasSelection) {
    return 'select';
  }

  if (key.upArrow) {
    return 'up';
  }

  if (key.downArrow && resultCount > 0) {
    return 'down';
  }

  if (key.backspace || key.delete) {
    return 'backspace';
  }

  if (input && !key.ctrl && !key.meta) {
    return 'text';
  }

  return 'none';
}
