import { useEffect, useState } from 'preact/hooks';

interface ScriptEntry {
  id: string;
  commandName: string;
  path: string;
  metadata: {
    name?: string;
    description?: string;
    usage?: string;
    tags: string[];
    examples: string[];
  };
}

export function App() {
  const [query, setQuery] = useState('');
  const [scripts, setScripts] = useState<ScriptEntry[]>([]);
  const [warningCount, setWarningCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadScripts() {
      const response = await fetch(`/api/scripts?q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
      });
      const data = await response.json();
      setScripts(data.scripts);
      setWarningCount(data.warnings.length);
    }

    loadScripts().catch((error) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        console.error(error);
      }
    });

    return () => controller.abort();
  }, [query]);

  return (
    <main>
      <header>
        <h1>min-script-launcher</h1>
        <input
          type='search'
          value={query}
          onInput={(event) => setQuery((event.target as HTMLInputElement).value)}
          placeholder='Search scripts'
          aria-label='Search scripts'
        />
        {warningCount > 0 && <p>{warningCount} catalog warning(s)</p>}
      </header>

      <section>
        {scripts.length === 0 ? (
          <p>No scripts found.</p>
        ) : (
          <ul>
            {scripts.map((script) => (
              <li key={script.id}>
                <strong>{script.commandName}</strong>
                {script.metadata.description && <p>{script.metadata.description}</p>}
                <code>{script.metadata.usage ?? script.path}</code>
                {script.metadata.tags.length > 0 && (
                  <small>{script.metadata.tags.join(', ')}</small>
                )}
                <span>{script.path}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
