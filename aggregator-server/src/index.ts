interface Env {
  // URLs for the individual MCP servers
  EXISTING_MCP_SERVER_URL?: string;
  ATLASSIAN_MCP_SERVER_URL?: string;
}

interface McpMessage {
  jsonrpc: '2.0';
  id?: string | number;
  method?: string;
  params?: any;
  result?: any;
  error?: any;
}

interface ToolInfo {
  name: string;
  description: string;
  inputSchema: any;
}

class McpAggregator {
  private env: Env;
  private existingServerUrl: string;
  private atlassianServerUrl: string;

  constructor(env: Env) {
    this.env = env;
    // Default URLs - these can be overridden by environment variables
    this.existingServerUrl = env.EXISTING_MCP_SERVER_URL || 'https://remote-mcp-server-authless.gladden4work.workers.dev';
    this.atlassianServerUrl = env.ATLASSIAN_MCP_SERVER_URL || 'https://atlassian-mcp-server.gladden4work.workers.dev';
  }

  private isAtlassianTool(toolName: string): boolean {
    const atlassianPrefixes = [
      'jira_',
      'confluence_',
      'atlassian_'
    ];
    return atlassianPrefixes.some(prefix => toolName.startsWith(prefix));
  }

  private async forwardRequest(serverUrl: string, message: McpMessage): Promise<McpMessage> {
    try {
      const response = await fetch(serverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message)
      });

      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32603,
          message: `Failed to contact server: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      };
    }
  }

  private async getAllTools(): Promise<ToolInfo[]> {
    const tools: ToolInfo[] = [];

    // Get tools from existing server
    try {
      const existingResponse = await this.forwardRequest(this.existingServerUrl, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list'
      });

      if (existingResponse.result?.tools) {
        tools.push(...existingResponse.result.tools);
      }
    } catch (error) {
      console.error('Failed to get tools from existing server:', error);
    }

    // Get tools from Atlassian server
    try {
      const atlassianResponse = await this.forwardRequest(this.atlassianServerUrl, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list'
      });

      if (atlassianResponse.result?.tools) {
        tools.push(...atlassianResponse.result.tools);
      }
    } catch (error) {
      console.error('Failed to get tools from Atlassian server:', error);
    }

    return tools;
  }

  async handleRequest(message: McpMessage): Promise<McpMessage> {
    // Handle initialization
    if (message.method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: 'mcp-aggregator-server',
            version: '1.0.0'
          }
        }
      };
    }

    // Handle tools/list - aggregate from both servers
    if (message.method === 'tools/list') {
      const allTools = await this.getAllTools();
      
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          tools: allTools
        }
      };
    }

    // Handle tools/call - route to appropriate server
    if (message.method === 'tools/call') {
      const toolName = message.params?.name;
      
      if (!toolName) {
        return {
          jsonrpc: '2.0',
          id: message.id,
          error: {
            code: -32602,
            message: 'Missing tool name in parameters'
          }
        };
      }

      // Route to appropriate server based on tool name
      const targetUrl = this.isAtlassianTool(toolName) 
        ? this.atlassianServerUrl 
        : this.existingServerUrl;

      return await this.forwardRequest(targetUrl, message);
    }

    // For any other method, try the existing server first, then Atlassian if that fails
    const existingResponse = await this.forwardRequest(this.existingServerUrl, message);
    
    // If existing server handled it successfully, return the response
    if (!existingResponse.error) {
      return existingResponse;
    }

    // If existing server failed, try Atlassian server
    return await this.forwardRequest(this.atlassianServerUrl, message);
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Handle CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // Handle SSE endpoint
    if (url.pathname === '/sse' && request.method === 'GET') {
      return new Response('SSE endpoint for MCP aggregator', {
        headers: {
          'Content-Type': 'text/plain',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Handle status/health check
    if (url.pathname === '/status' && request.method === 'GET') {
      const existingUrl = env.EXISTING_MCP_SERVER_URL || 'https://remote-mcp-server-authless.gladden4work.workers.dev';
      const atlassianUrl = env.ATLASSIAN_MCP_SERVER_URL || 'https://atlassian-mcp-server.gladden4work.workers.dev';
      
      return new Response(JSON.stringify({
        status: 'active',
        servers: {
          existing: existingUrl,
          atlassian: atlassianUrl
        },
        timestamp: new Date().toISOString()
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Handle MCP requests
    if (request.method === 'POST') {
      try {
        const message: McpMessage = await request.json();
        const aggregator = new McpAggregator(env);
        const response = await aggregator.handleRequest(message);

        return new Response(JSON.stringify(response), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      } catch (error) {
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: -32700,
            message: 'Parse error'
          }
        }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
    }

    // Default response
    return new Response(`
MCP Aggregator Server

This server aggregates multiple MCP servers:
- Existing Server: ${env.EXISTING_MCP_SERVER_URL || 'https://remote-mcp-server-authless.gladden4work.workers.dev'}
- Atlassian Server: ${env.ATLASSIAN_MCP_SERVER_URL || 'https://atlassian-mcp-server.gladden4work.workers.dev'}

Endpoints:
- POST / - MCP JSON-RPC requests
- GET /sse - SSE endpoint for MCP clients  
- GET /status - Server status and configuration
    `, {
      headers: {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*',
      },
    });
  },
};