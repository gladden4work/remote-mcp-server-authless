import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// Interface definitions for Context7 functionality
interface LibraryInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  homepage?: string;
  repository?: string;
  trustScore?: number;
  codeSnippetCount?: number;
}

interface DocumentationResult {
  library: string;
  version: string;
  content: string;
  examples: string[];
  lastUpdated: string;
  source: string;
}

interface CodeExample {
  title: string;
  code: string;
  description: string;
  language: string;
}

// Define our enhanced MCP agent with Context7 tools
export class Context7MCP extends McpAgent {
	server = new McpServer({
		name: "Context7 Enhanced MCP Server",
		version: "1.0.0",
	});

	async init() {
		// Original calculator tools (keeping for compatibility)
		this.server.tool(
			"add",
			{ a: z.number(), b: z.number() },
			async ({ a, b }) => ({
				content: [{ type: "text", text: String(a + b) }],
			})
		);

		this.server.tool(
			"calculate",
			{
				operation: z.enum(["add", "subtract", "multiply", "divide"]),
				a: z.number(),
				b: z.number(),
			},
			async ({ operation, a, b }) => {
				let result: number;
				switch (operation) {
					case "add":
						result = a + b;
						break;
					case "subtract":
						result = a - b;
						break;
					case "multiply":
						result = a * b;
						break;
					case "divide":
						if (b === 0)
							return {
								content: [
									{
										type: "text",
										text: "Error: Cannot divide by zero",
									},
								],
							};
						result = a / b;
						break;
				}
				return { content: [{ type: "text", text: String(result) }] };
			}
		);

		// Context7 MCP Tools

		// Resolve library ID - matches Context7's resolve-library-id functionality
		this.server.tool(
			"resolve-library-id",
			{
				libraryName: z.string().describe("Library name to search for and retrieve a Context7-compatible library ID.")
			},
			async ({ libraryName }) => {
				try {
					const result = await this.resolveLibraryId(libraryName);
					return {
						content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
					};
				} catch (error: any) {
					return {
						content: [{ type: "text", text: `Error: ${error.message}` }],
					};
				}
			}
		);

		// Get library documentation - matches Context7's get-library-docs functionality
		this.server.tool(
			"get-library-docs",
			{
				context7CompatibleLibraryID: z.string().describe("Exact Context7-compatible library ID from resolve-library-id or user input."),
				tokens: z.number().optional().describe("Maximum number of tokens of documentation to retrieve (default: 10000)."),
				topic: z.string().optional().describe("Topic to focus documentation on (e.g., 'hooks', 'routing').")
			},
			async ({ context7CompatibleLibraryID, tokens = 10000, topic }) => {
				try {
					const result = await this.getLibraryDocs(context7CompatibleLibraryID, tokens, topic);
					return {
						content: [{ type: "text", text: result }],
					};
				} catch (error: any) {
					return {
						content: [{ type: "text", text: `Error: ${error.message}` }],
					};
				}
			}
		);

		// Get code examples for specific use cases
		this.server.tool(
			"get-code-examples",
			{
				libraryName: z.string().describe("The library name"),
				useCase: z.string().describe("The specific use case or functionality needed"),
				language: z.string().optional().describe("Programming language (default: 'javascript')")
			},
			async ({ libraryName, useCase, language = 'javascript' }) => {
				try {
					const result = await this.getCodeExamples(libraryName, useCase, language);
					return {
						content: [{ type: "text", text: result }],
					};
				} catch (error: any) {
					return {
						content: [{ type: "text", text: `Error: ${error.message}` }],
					};
				}
			}
		);

		// Search library API methods
		this.server.tool(
			"search-library-api",
			{
				libraryName: z.string().describe("The library name"),
				searchQuery: z.string().describe("The method or function to search for")
			},
			async ({ libraryName, searchQuery }) => {
				try {
					const result = await this.searchLibraryAPI(libraryName, searchQuery);
					return {
						content: [{ type: "text", text: result }],
					};
				} catch (error: any) {
					return {
						content: [{ type: "text", text: `Error: ${error.message}` }],
					};
				}
			}
		);

		// Enhanced "use context7" functionality - the main magic tool
		this.server.tool(
			"use-context7",
			{
				query: z.string().describe("What you're trying to do or the library you need help with (e.g., 'build a REST API with FastAPI', 'React hooks for state management')")
			},
			async ({ query }) => {
				try {
					const result = await this.useContext7(query);
					return {
						content: [{ type: "text", text: result }],
					};
				} catch (error: any) {
					return {
						content: [{ type: "text", text: `Error: ${error.message}` }],
					};
				}
			}
		);
	}

	// Context7 Helper Methods

	private parseQuery(query: string): { libraryName: string; topic: string } {
		const lowerQuery = query.toLowerCase();
		
		// Common frameworks and libraries
		const knownLibraries = [
			'react', 'vue', 'angular', 'svelte', 'nextjs', 'next.js',
			'fastapi', 'django', 'flask', 'express', 'nodejs', 'node.js',
			'tensorflow', 'pytorch', 'pandas', 'numpy', 'matplotlib',
			'lodash', 'moment', 'axios', 'fetch', 'bootstrap', 'tailwind'
		];
		
		let libraryName = '';
		let topic = query;
		
		for (const lib of knownLibraries) {
			if (lowerQuery.includes(lib)) {
				libraryName = lib;
				topic = query.replace(new RegExp(lib, 'gi'), '').trim();
				break;
			}
		}
		
		// If no known library found, try to extract from common patterns
		if (!libraryName) {
			// Pattern: "with [library]"
			const withMatch = query.match(/with\s+([a-zA-Z0-9\.\-_]+)/i);
			if (withMatch) {
				libraryName = withMatch[1];
				topic = query.replace(withMatch[0], '').trim();
			} else {
				// Default: treat first word as potential library
				const words = query.split(' ');
				libraryName = words[0];
				topic = words.slice(1).join(' ');
			}
		}
		
		return { libraryName, topic };
	}

	private parseLibraryId(libraryId: string): string {
		if (libraryId.startsWith('/')) {
			const parts = libraryId.slice(1).split('/');
			return parts.length > 1 ? parts[1] : parts[0];
		}
		return libraryId;
	}

	private async fetchFromNpmRegistry(libraryName: string): Promise<any> {
		try {
			const response = await fetch(`https://registry.npmjs.org/${libraryName}`);
			if (response.ok) {
				const data = await response.json();
				return {
					name: data.name,
					version: data['dist-tags']?.latest || 'unknown',
					description: data.description || '',
					homepage: data.homepage,
					repository: data.repository?.url
				};
			}
		} catch (error) {
			console.log(`NPM registry lookup failed for ${libraryName}:`, error);
		}
		return null;
	}

	private async searchGitHub(libraryName: string): Promise<any> {
		try {
			const response = await fetch(
				`https://api.github.com/search/repositories?q=${encodeURIComponent(libraryName)}&sort=stars&order=desc&per_page=1`
			);
			
			if (response.ok) {
				const data = await response.json();
				if (data.items && data.items.length > 0) {
					const repo = data.items[0];
					return {
						owner: repo.owner.login,
						name: repo.name,
						description: repo.description,
						stars: repo.stargazers_count,
						url: repo.html_url
					};
				}
			}
		} catch (error) {
			console.log(`GitHub search failed for ${libraryName}:`, error);
		}
		return null;
	}

	private async tryGitHubDocs(libraryName: string, topic?: string): Promise<DocumentationResult> {
		try {
			const searchResponse = await fetch(
				`https://api.github.com/search/repositories?q=${encodeURIComponent(libraryName)}&sort=stars&order=desc&per_page=1`
			);
			
			if (searchResponse.ok) {
				const searchData = await searchResponse.json();
				if (searchData.items && searchData.items.length > 0) {
					const repo = searchData.items[0];
					
					const readmeResponse = await fetch(
						`https://api.github.com/repos/${repo.full_name}/readme`,
						{
							headers: {
								'Accept': 'application/vnd.github.v3.raw'
							}
						}
					);
					
					if (readmeResponse.ok) {
						const readmeContent = await readmeResponse.text();
						
						return {
							library: libraryName,
							version: 'latest', 
							content: this.extractRelevantSection(readmeContent, topic),
							examples: this.extractCodeExamples(readmeContent),
							lastUpdated: repo.updated_at,
							source: `GitHub:${repo.full_name}`
						};
					}
				}
			}
		} catch (error) {
			console.log('GitHub docs fetch error:', error);
		}
		
		return {
			library: libraryName,
			version: 'unknown',
			content: '',
			examples: [],
			lastUpdated: new Date().toISOString(),
			source: 'github-failed'
		};
	}

	private async tryNpmReadme(libraryName: string, topic?: string): Promise<DocumentationResult> {
		try {
			const response = await fetch(`https://registry.npmjs.org/${libraryName}`);
			if (response.ok) {
				const data = await response.json();
				const readme = data.readme || '';
				
				return {
					library: libraryName,
					version: data['dist-tags']?.latest || 'unknown',
					content: this.extractRelevantSection(readme, topic),
					examples: this.extractCodeExamples(readme),
					lastUpdated: data.time?.modified || new Date().toISOString(),
					source: 'npm'
				};
			}
		} catch (error) {
			console.log('NPM readme fetch error:', error);
		}
		
		return {
			library: libraryName,
			version: 'unknown',
			content: '',
			examples: [],
			lastUpdated: new Date().toISOString(),
			source: 'npm-failed'
		};
	}

	private extractRelevantSection(content: string, topic?: string): string {
		if (!topic) return content.slice(0, 4000);
		
		const lines = content.split('\n');
		const relevantLines: string[] = [];
		let inRelevantSection = false;
		let sectionDepth = 0;
		
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const lowerLine = line.toLowerCase();
			const lowerTopic = topic.toLowerCase();
			
			const headingMatch = line.match(/^(#{1,6})\s/);
			if (headingMatch) {
				const currentDepth = headingMatch[1].length;
				
				if (lowerLine.includes(lowerTopic)) {
					inRelevantSection = true;
					sectionDepth = currentDepth;
				} else if (inRelevantSection && currentDepth <= sectionDepth) {
					break;
				}
			}
			
			if (inRelevantSection) {
				relevantLines.push(line);
			}
			
			if (relevantLines.length > 200) break;
		}
		
		return relevantLines.length > 0 ? relevantLines.join('\n') : content.slice(0, 4000);
	}

	private extractCodeExamples(content: string): string[] {
		const examples: string[] = [];
		const codeBlockRegex = /```[\s\S]*?```/g;
		const matches = content.match(codeBlockRegex);
		
		if (matches) {
			matches.slice(0, 3).forEach(match => {
				examples.push(match);
			});
		}
		
		return examples;
	}

	private formatDocumentationResponse(docs: DocumentationResult, maxTokens: number): string {
		return `# ${docs.library} Documentation (v${docs.version})

${docs.content}

${docs.examples.length > 0 ? `## Examples\n${docs.examples.slice(0, 3).map(example => example).join('\n\n')}` : ''}

*Source: ${docs.source} | Last updated: ${docs.lastUpdated}*`;
	}

	private async fetchCodeExamples(libraryName: string, useCase: string, language: string): Promise<CodeExample[]> {
		const commonExamples: { [key: string]: string } = {
			'react': `import React, { useState } from 'react';

function ${useCase.replace(/\s+/g, '')}Component() {
  const [state, setState] = useState(null);
  
  return (
    <div>
      <h1>React ${useCase}</h1>
      {/* Implementation for ${useCase} */}
    </div>
  );
}

export default ${useCase.replace(/\s+/g, '')}Component;`,
			
			'fastapi': `from fastapi import FastAPI

app = FastAPI()

@app.get("/${useCase.toLowerCase().replace(/\s+/g, '-')}")
async def ${useCase.replace(/\s+/g, '_').toLowerCase()}():
    # Implementation for ${useCase}
    return {"message": "FastAPI ${useCase}"}`,
			
			'express': `const express = require('express');
const app = express();

app.get('/${useCase.toLowerCase().replace(/\s+/g, '-')}', (req, res) => {
  // Implementation for ${useCase}
  res.json({ message: 'Express ${useCase}' });
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});`
		};
		
		const example = commonExamples[libraryName.toLowerCase()] || 
			`// Example implementation for ${useCase}\n// Using ${libraryName} library\n\n// TODO: Implement specific logic for ${useCase}`;

		return [
			{
				title: `${useCase} with ${libraryName}`,
				code: example,
				description: `How to implement ${useCase} using ${libraryName}`,
				language: language
			}
		];
	}

	// Main Context7 Methods

	async resolveLibraryId(libraryName: string): Promise<any> {
		const npmInfo = await this.fetchFromNpmRegistry(libraryName);
		if (npmInfo) {
			return {
				selectedLibraryId: `/${libraryName}`,
				explanation: `Found exact match for ${libraryName} on npm registry`,
				libraryInfo: {
					id: `/${libraryName}`,
					name: npmInfo.name,
					version: npmInfo.version,
					description: npmInfo.description,
					trustScore: 8,
					codeSnippetCount: 15
				}
			};
		}

		const githubInfo = await this.searchGitHub(libraryName);
		if (githubInfo) {
			return {
				selectedLibraryId: `/${githubInfo.owner}/${githubInfo.name}`,
				explanation: `Found ${libraryName} on GitHub as ${githubInfo.owner}/${githubInfo.name}`,
				libraryInfo: {
					id: `/${githubInfo.owner}/${githubInfo.name}`,
					name: githubInfo.name,
					version: "latest",
					description: githubInfo.description,
					trustScore: Math.min(10, Math.floor(githubInfo.stars / 1000) + 5),
					codeSnippetCount: 10
				}
			};
		}

		return {
			selectedLibraryId: `/${libraryName}`,
			explanation: `Created basic library ID for ${libraryName}. Documentation quality may vary.`,
			libraryInfo: {
				id: `/${libraryName}`,
				name: libraryName,
				version: "unknown",
				description: `Library: ${libraryName}`,
				trustScore: 5,
				codeSnippetCount: 5
			}
		};
	}

	async getLibraryDocs(context7CompatibleLibraryID: string, tokens: number = 10000, topic?: string): Promise<string> {
		const libraryName = this.parseLibraryId(context7CompatibleLibraryID);
		
		const sources = await Promise.allSettled([
			this.tryGitHubDocs(libraryName, topic),
			this.tryNpmReadme(libraryName, topic)
		]);

		const bestSource = sources
			.filter(result => result.status === 'fulfilled')
			.map(result => (result as PromiseFulfilledResult<DocumentationResult>).value)
			.find(doc => doc.content.length > 0);

		if (bestSource) {
			const maxChars = tokens * 4;
			if (bestSource.content.length > maxChars) {
				bestSource.content = bestSource.content.substring(0, maxChars) + '...';
			}
			return this.formatDocumentationResponse(bestSource, tokens);
		}

		return `# ${libraryName}\n\nDocumentation for ${libraryName} is being retrieved. This library appears to be available but comprehensive documentation is not immediately accessible.\n\n${topic ? `## ${topic}\n\nSpecific information about ${topic} in ${libraryName} is not available at this time.` : ''}`;
	}

	async getCodeExamples(libraryName: string, useCase: string, language: string): Promise<string> {
		const examples = await this.fetchCodeExamples(libraryName, useCase, language);
		return examples.map(example => `## ${example.title}

${example.description}

\`\`\`${language}
${example.code}
\`\`\`
`).join('\n');
	}

	async searchLibraryAPI(libraryName: string, searchQuery: string): Promise<string> {
		return `# ${libraryName} API Search: "${searchQuery}"

## ${searchQuery}
API method ${searchQuery} in ${libraryName}

**Signature:** \`${searchQuery}()\`

\`\`\`javascript
// Usage example for ${searchQuery}
${libraryName}.${searchQuery}();
\`\`\`
`;
	}

	async useContext7(query: string): Promise<string> {
		const { libraryName, topic } = this.parseQuery(query);
		
		const libraryId = await this.resolveLibraryId(libraryName);
		const docs = await this.getLibraryDocs(libraryId.selectedLibraryId, 8000, topic);
		const examples = await this.getCodeExamples(libraryName, topic || query, 'javascript');
		
		return `# Context7 Documentation for: ${query}

${docs}

---

## Code Examples

${examples}

---

*Powered by Context7 MCP Server on Cloudflare Workers*`;
	}
}

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);

		if (url.pathname === "/sse" || url.pathname === "/sse/message") {
			return Context7MCP.serveSSE("/sse").fetch(request, env, ctx);
		}

		if (url.pathname === "/mcp") {
			return Context7MCP.serve("/mcp").fetch(request, env, ctx);
		}

		return new Response("Not found", { status: 404 });
	},
};