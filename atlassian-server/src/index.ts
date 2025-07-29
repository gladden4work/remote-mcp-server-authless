interface Env {
  ATLASSIAN_EMAIL: string;
  ATLASSIAN_API_TOKEN: string;
  ATLASSIAN_JIRA_URL: string;
  ATLASSIAN_CONFLUENCE_URL: string;
}

interface McpMessage {
  jsonrpc: '2.0';
  id?: string | number;
  method?: string;
  params?: any;
  result?: any;
  error?: any;
}

class AtlassianMcpAgent {
  private env: Env;
  private tools: Map<string, any> = new Map();

  constructor(env: Env) {
    this.env = env;
    this.initializeTools();
  }

  private async makeAtlassianRequest(
    url: string, 
    options: RequestInit = {}
  ) {
    const auth = btoa(`${this.env.ATLASSIAN_EMAIL}:${this.env.ATLASSIAN_API_TOKEN}`);
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...options.headers
      }
    });

    if (!response.ok) {
      throw new Error(`Atlassian API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  private initializeTools() {
    // Jira Search Tool
    this.tools.set('jira_search', {
      description: 'Search for Jira issues using JQL',
      inputSchema: {
        type: 'object',
        properties: {
          jql: { type: 'string', description: 'JQL query string' },
          maxResults: { type: 'number', description: 'Max results (default: 50)' }
        },
        required: ['jql']
      },
      handler: async (params: any) => {
        const { jql, maxResults = 50 } = params;
        const url = `${this.env.ATLASSIAN_JIRA_URL}/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}`;
        
        try {
          const data = await this.makeAtlassianRequest(url);
          
          return {
            content: [{
              type: 'text',
              text: `Found ${data.total} issues:\n\n` + 
                    data.issues.map((issue: any) => 
                      `**${issue.key}**: ${issue.fields.summary}\n` +
                      `Status: ${issue.fields.status.name}\n` +
                      `Assignee: ${issue.fields.assignee?.displayName || 'Unassigned'}\n` +
                      `Link: ${this.env.ATLASSIAN_JIRA_URL}/browse/${issue.key}\n`
                    ).join('\n')
            }]
          };
        } catch (error) {
          throw new Error(`Failed to search Jira: ${error}`);
        }
      }
    });

    // Jira Issue Creation Tool
    this.tools.set('jira_create_issue', {
      description: 'Create a new Jira issue',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project key' },
          summary: { type: 'string', description: 'Issue summary' },
          description: { type: 'string', description: 'Issue description' },
          issueType: { type: 'string', description: 'Issue type (e.g., Task, Bug, Story)', default: 'Task' },
          priority: { type: 'string', description: 'Priority (e.g., High, Medium, Low)', default: 'Medium' }
        },
        required: ['project', 'summary']
      },
      handler: async (params: any) => {
        const { project, summary, description, issueType = 'Task', priority = 'Medium' } = params;
        const url = `${this.env.ATLASSIAN_JIRA_URL}/rest/api/3/issue`;
        
        const issueData = {
          fields: {
            project: { key: project },
            summary,
            description: {
              type: 'doc',
              version: 1,
              content: [{
                type: 'paragraph',
                content: [{ type: 'text', text: description || '' }]
              }]
            },
            issuetype: { name: issueType },
            priority: { name: priority }
          }
        };

        try {
          const data = await this.makeAtlassianRequest(url, {
            method: 'POST',
            body: JSON.stringify(issueData)
          });
          
          return {
            content: [{
              type: 'text',
              text: `✅ Created Jira issue: ${data.key}\n` +
                    `Summary: ${summary}\n` +
                    `Link: ${this.env.ATLASSIAN_JIRA_URL}/browse/${data.key}`
            }]
          };
        } catch (error) {
          throw new Error(`Failed to create Jira issue: ${error}`);
        }
      }
    });

    // Confluence Search Tool
    this.tools.set('confluence_search', {
      description: 'Search Confluence content',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          spaceKey: { type: 'string', description: 'Limit to specific space' },
          maxResults: { type: 'number', description: 'Max results (default: 25)' }
        },
        required: ['query']
      },
      handler: async (params: any) => {
        const { query, spaceKey, maxResults = 25 } = params;
        
        let cql = `text ~ "${query}"`;
        if (spaceKey) {
          cql += ` AND space = "${spaceKey}"`;
        }
        
        const url = `${this.env.ATLASSIAN_CONFLUENCE_URL}/rest/api/content/search?cql=${encodeURIComponent(cql)}&limit=${maxResults}`;
        
        try {
          const data = await this.makeAtlassianRequest(url);
          
          return {
            content: [{
              type: 'text',
              text: `Found ${data.size} pages:\n\n` + 
                    data.results.map((page: any) => 
                      `**${page.title}**\n` +
                      `Space: ${page.space.name}\n` +
                      `Type: ${page.type}\n` +
                      `Link: ${this.env.ATLASSIAN_CONFLUENCE_URL}${page._links.webui}\n`
                    ).join('\n')
            }]
          };
        } catch (error) {
          throw new Error(`Failed to search Confluence: ${error}`);
        }
      }
    });

    // Confluence Page Creation Tool
    this.tools.set('confluence_create_page', {
      description: 'Create a new Confluence page',
      inputSchema: {
        type: 'object',
        properties: {
          spaceKey: { type: 'string', description: 'Space key where to create the page' },
          title: { type: 'string', description: 'Page title' },
          content: { type: 'string', description: 'Page content (HTML)' },
          parentId: { type: 'string', description: 'Parent page ID (optional)' }
        },
        required: ['spaceKey', 'title', 'content']
      },
      handler: async (params: any) => {
        const { spaceKey, title, content, parentId } = params;
        const url = `${this.env.ATLASSIAN_CONFLUENCE_URL}/rest/api/content`;
        
        const pageData: any = {
          type: 'page',
          title,
          space: { key: spaceKey },
          body: {
            storage: {
              value: content,
              representation: 'storage'
            }
          }
        };

        if (parentId) {
          pageData.ancestors = [{ id: parentId }];
        }

        try {
          const data = await this.makeAtlassianRequest(url, {
            method: 'POST',
            body: JSON.stringify(pageData)
          });
          
          return {
            content: [{
              type: 'text',
              text: `✅ Created Confluence page: "${title}"\n` +
                    `Space: ${spaceKey}\n` +
                    `Link: ${this.env.ATLASSIAN_CONFLUENCE_URL}${data._links.webui}`
            }]
          };
        } catch (error) {
          throw new Error(`Failed to create Confluence page: ${error}`);
        }
      }
    });

    // Jira Project List Tool
    this.tools.set('jira_list_projects', {
      description: 'List all accessible Jira projects',
      inputSchema: {
        type: 'object',
        properties: {}
      },
      handler: async (params: any) => {
        const url = `${this.env.ATLASSIAN_JIRA_URL}/rest/api/3/project`;
        
        try {
          const data = await this.makeAtlassianRequest(url);
          
          return {
            content: [{
              type: 'text',
              text: `Found ${data.length} projects:\n\n` + 
                    data.map((project: any) => 
                      `**${project.key}**: ${project.name}\n` +
                      `Type: ${project.projectTypeKey}\n` +
                      `Lead: ${project.lead?.displayName || 'No lead'}\n`
                    ).join('\n')
            }]
          };
        } catch (error) {
          throw new Error(`Failed to list Jira projects: ${error}`);
        }
      }
    });

    // Confluence Spaces List Tool
    this.tools.set('confluence_list_spaces', {
      description: 'List all accessible Confluence spaces',
      inputSchema: {
        type: 'object',
        properties: {}
      },
      handler: async (params: any) => {
        const url = `${this.env.ATLASSIAN_CONFLUENCE_URL}/rest/api/space`;
        
        try {
          const data = await this.makeAtlassianRequest(url);
          
          return {
            content: [{
              type: 'text',
              text: `Found ${data.size} spaces:\n\n` + 
                    data.results.map((space: any) => 
                      `**${space.key}**: ${space.name}\n` +
                      `Type: ${space.type}\n` +
                      `Link: ${this.env.ATLASSIAN_CONFLUENCE_URL}${space._links.webui}\n`
                    ).join('\n')
            }]
          };
        } catch (error) {
          throw new Error(`Failed to list Confluence spaces: ${error}`);
        }
      }
    });
  }

  async handleRequest(message: McpMessage): Promise<McpMessage> {
    if (message.method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          tools: Array.from(this.tools.entries()).map(([name, tool]) => ({
            name,
            description: tool.description,
            inputSchema: tool.inputSchema
          }))
        }
      };
    }

    if (message.method === 'tools/call') {
      const { name, arguments: args } = message.params;
      const tool = this.tools.get(name);
      
      if (!tool) {
        return {
          jsonrpc: '2.0',
          id: message.id,
          error: {
            code: -32601,
            message: `Tool not found: ${name}`
          }
        };
      }

      try {
        const result = await tool.handler(args);
        return {
          jsonrpc: '2.0',
          id: message.id,
          result
        };
      } catch (error) {
        return {
          jsonrpc: '2.0',
          id: message.id,
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : 'Unknown error'
          }
        };
      }
    }

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
            name: 'atlassian-mcp-server',
            version: '1.0.0'
          }
        }
      };
    }

    return {
      jsonrpc: '2.0',
      id: message.id,
      error: {
        code: -32601,
        message: 'Method not found'
      }
    };
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
      return new Response('SSE endpoint for MCP client connection', {
        headers: {
          'Content-Type': 'text/plain',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Handle MCP requests
    if (request.method === 'POST') {
      try {
        const message: McpMessage = await request.json();
        const agent = new AtlassianMcpAgent(env);
        const response = await agent.handleRequest(message);

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

    return new Response('Atlassian MCP Server', {
      headers: {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*',
      },
    });
  },
};