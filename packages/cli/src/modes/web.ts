import { createServer, type ServerResponse } from 'node:http';
import { discoverScripts, searchScripts } from '@min-script-launcher/core';

export async function startWebMode(port = 3000): Promise<void> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (url.pathname === '/api/health') {
      sendJson(res, { status: 'ok', timestamp: new Date().toISOString() });
      return;
    }

    if (url.pathname === '/api/scripts') {
      const discovery = await discoverScripts();
      const query = url.searchParams.get('q') ?? '';
      const scripts = query
        ? searchScripts(discovery.scripts, query).map((result) => result.entry)
        : discovery.scripts;
      sendJson(res, { scripts, warnings: discovery.warnings });
      return;
    }

    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(searchPageHtml());
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  await new Promise<void>((resolve) => {
    server.listen(port, () => resolve());
  });

  console.log(`min-script-launcher web search running at http://localhost:${port}`);
}

function sendJson(res: ServerResponse, body: unknown): void {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function searchPageHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>min-script-launcher</title>
    <style>
      body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; background: #f7f7f3; color: #171717; }
      main { max-width: 920px; margin: 0 auto; padding: 32px 20px; }
      input { width: 100%; box-sizing: border-box; padding: 12px 14px; border: 1px solid #b8b8ad; border-radius: 6px; font: inherit; }
      ul { list-style: none; padding: 0; margin: 20px 0 0; }
      li { border-bottom: 1px solid #ddddcf; padding: 14px 0; }
      code { color: #146152; }
      .path { color: #666; font-size: 13px; }
    </style>
  </head>
  <body>
    <main>
      <h1>min-script-launcher</h1>
      <input id="q" autofocus placeholder="Search scripts" />
      <ul id="results"></ul>
    </main>
    <script>
      const q = document.querySelector('#q');
      const results = document.querySelector('#results');
      function escapeHtml(value) {
        return String(value || '').replace(/[&<>"']/g, (char) => ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;'
        }[char]));
      }
      async function load() {
        const response = await fetch('/api/scripts?q=' + encodeURIComponent(q.value));
        const data = await response.json();
        results.innerHTML = data.scripts.map((script) => '<li><strong>' + escapeHtml(script.commandName) + '</strong><div>' + escapeHtml(script.metadata.description) + '</div><code>' + escapeHtml(script.metadata.usage || script.path) + '</code><div class="path">' + escapeHtml(script.path) + '</div></li>').join('');
      }
      q.addEventListener('input', load);
      load();
    </script>
  </body>
</html>`;
}
