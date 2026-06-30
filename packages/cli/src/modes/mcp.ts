import {
  discoverScripts,
  findScript,
  metadataAuthoringGuide,
  searchScripts,
} from '@min-script-launcher/core';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

const SearchArgsSchema = z.object({
  query: z.string().default(''),
});

const ExplainArgsSchema = z.object({
  script: z.string(),
});

export async function startMcpMode(): Promise<void> {
  const server = new Server(
    {
      name: 'min-script-launcher',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'search_scripts',
        description: 'Search executable scripts in configured min-script-launcher directories.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search text' },
          },
        },
      },
      {
        name: 'explain_script',
        description: 'Show metadata, usage, examples, and path for a discovered script.',
        inputSchema: {
          type: 'object',
          properties: {
            script: { type: 'string', description: 'Command name, display name, alias, or path' },
          },
          required: ['script'],
        },
      },
      {
        name: 'script_authoring_guide',
        description: 'Show metadata guidance for coding agents that generate scripts.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      return await handleToolCall(request.params.name, request.params.arguments);
    } catch (error) {
      return {
        ...textResponse(`Error: ${error instanceof Error ? error.message : String(error)}`),
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('min-script-launcher MCP server running on stdio');
}

async function handleToolCall(name: string, args: unknown) {
  switch (name) {
    case 'search_scripts':
      return searchScriptsResponse(args);
    case 'explain_script':
      return explainScriptResponse(args);
    case 'script_authoring_guide':
      return textResponse(metadataAuthoringGuide());
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function searchScriptsResponse(rawArgs: unknown) {
  const args = SearchArgsSchema.parse(rawArgs ?? {});
  const discovery = await discoverScripts();
  const scripts = searchScripts(discovery.scripts, args.query).map((result) => ({
    commandName: result.entry.commandName,
    name: result.entry.metadata.name,
    description: result.entry.metadata.description,
    usage: result.entry.metadata.usage,
    tags: result.entry.metadata.tags,
    path: result.entry.path,
  }));

  return textResponse(JSON.stringify({ scripts, warnings: discovery.warnings }, null, 2));
}

async function explainScriptResponse(rawArgs: unknown) {
  const args = ExplainArgsSchema.parse(rawArgs ?? {});
  const discovery = await discoverScripts();
  const script = findScript(discovery.scripts, args.script);

  if (!script) {
    throw new Error(`No script found for ${args.script}`);
  }

  return textResponse(JSON.stringify(script, null, 2));
}

function textResponse(text: string) {
  return {
    content: [
      {
        type: 'text' as const,
        text,
      },
    ],
  };
}
