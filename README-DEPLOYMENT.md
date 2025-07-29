# MCP Aggregator Deployment Guide

This repository now contains three MCP servers:

1. **Original Server** (`src/index.ts`) - Your existing MCP server
2. **Atlassian Server** (`atlassian-server/`) - New Atlassian integration
3. **Aggregator Server** (`aggregator-server/`) - Routes between multiple servers

## Quick Deployment

### 1. Deploy the Atlassian MCP Server

```bash
cd atlassian-server

# Set up Atlassian credentials as secrets
wrangler secret put ATLASSIAN_EMAIL
wrangler secret put ATLASSIAN_API_TOKEN
wrangler secret put ATLASSIAN_JIRA_URL
wrangler secret put ATLASSIAN_CONFLUENCE_URL

# Deploy
wrangler deploy
```

### 2. Deploy the Aggregator Server

```bash
cd aggregator-server
wrangler deploy
```

### 3. Configure Your MCP Client

Update your Claude Desktop configuration to use the aggregator:

```json
{
  "mcpServers": {
    "aggregator": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://mcp-aggregator-server.gladden4work.workers.dev/sse"
      ]
    }
  }
}
```

## What You Get

### Atlassian Tools Available:
- `jira_search` - Search Jira issues with JQL
- `jira_create_issue` - Create new Jira issues
- `jira_list_projects` - List all accessible projects
- `confluence_search` - Search Confluence content
- `confluence_create_page` - Create new Confluence pages
- `confluence_list_spaces` - List all accessible spaces

### How It Works

The aggregator automatically routes:
- Tools starting with `jira_` or `confluence_` → Atlassian server
- All other tools → Your existing server
- Both sets of tools appear as one unified interface

### Environment Variables

#### Atlassian Server Secrets:
- `ATLASSIAN_EMAIL` - Your Atlassian account email
- `ATLASSIAN_API_TOKEN` - API token from Atlassian
- `ATLASSIAN_JIRA_URL` - Your Jira instance URL (e.g., https://yourcompany.atlassian.net)
- `ATLASSIAN_CONFLUENCE_URL` - Your Confluence instance URL

#### Aggregator Server (Optional):
- `EXISTING_MCP_SERVER_URL` - Override default existing server URL
- `ATLASSIAN_MCP_SERVER_URL` - Override default Atlassian server URL

## Testing

Test each server individually:

1. **Atlassian Server**: `https://atlassian-mcp-server.gladden4work.workers.dev/status`
2. **Aggregator Server**: `https://mcp-aggregator-server.gladden4work.workers.dev/status`
3. **Existing Server**: `https://remote-mcp-server-authless.gladden4work.workers.dev/sse`

## Troubleshooting

1. **Atlassian API Issues**: Check your credentials and URLs
2. **Tool Not Found**: Ensure the aggregator can reach both servers
3. **CORS Issues**: All servers include CORS headers for cross-origin requests

The aggregator provides a unified interface while keeping your servers modular and maintainable!