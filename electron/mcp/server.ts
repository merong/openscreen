import { randomUUID } from "node:crypto";
import {
	createServer,
	type Server as HttpServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
	CallToolRequestSchema,
	type CallToolResult,
	isInitializeRequest,
	ListResourcesRequestSchema,
	ListToolsRequestSchema,
	ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { McpResourceDefinition } from "./resources";
import { type McpToolDefinition, mcpToolDefinitions, type OpenScreenMcpToolContext } from "./tools";
import type { JsonObject, McpToolResult } from "./toolTypes";

interface StartMcpServerOptions {
	host?: string;
	port?: number;
	path?: string;
	context: OpenScreenMcpToolContext;
	resources: McpResourceDefinition[];
	appVersion: string;
}

export interface McpHttpServerController {
	url: string;
	close: () => Promise<void>;
	getStatus: () => Record<string, unknown>;
}

interface TransportSession {
	server: Server;
	transport: StreamableHTTPServerTransport;
	createdAt: number;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 18888;
const DEFAULT_PATH = "/mcp";
const MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024;

function getHeader(req: IncomingMessage, name: string): string | undefined {
	const value = req.headers[name.toLowerCase()];
	return Array.isArray(value) ? value[0] : value;
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown) {
	if (res.headersSent) {
		return;
	}

	res.writeHead(statusCode, {
		"Content-Type": "application/json",
		"Cache-Control": "no-store",
	});
	res.end(JSON.stringify(body));
}

function jsonRpcError(statusCode: number, code: number, message: string) {
	return {
		statusCode,
		body: {
			jsonrpc: "2.0",
			error: { code, message },
			id: null,
		},
	};
}

function parseJsonBody(req: IncomingMessage): Promise<unknown> {
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks: Buffer[] = [];

		req.on("data", (chunk: Buffer) => {
			size += chunk.byteLength;
			if (size > MAX_REQUEST_BODY_BYTES) {
				reject(new Error("MCP request body is too large."));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});

		req.on("end", () => {
			const text = Buffer.concat(chunks).toString("utf-8");
			if (!text.trim()) {
				resolve(undefined);
				return;
			}

			try {
				resolve(JSON.parse(text));
			} catch {
				reject(new Error("MCP request body is not valid JSON."));
			}
		});
		req.on("error", reject);
	});
}

function getAllowedOrigins(port: number): Set<string> {
	const origins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
	const devServerUrl = process.env["VITE_DEV_SERVER_URL"];
	if (devServerUrl) {
		try {
			origins.add(new URL(devServerUrl).origin);
		} catch {
			// Ignore malformed dev server URLs.
		}
	}
	return origins;
}

function validateHttpBoundary(req: IncomingMessage, port: number) {
	const host = getHeader(req, "host");
	const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
	if (host && !allowedHosts.has(host.toLowerCase())) {
		return jsonRpcError(403, -32000, "Forbidden host.");
	}

	const origin = getHeader(req, "origin");
	if (origin) {
		let parsedOrigin: string;
		try {
			parsedOrigin = new URL(origin).origin;
		} catch {
			return jsonRpcError(403, -32000, "Forbidden origin.");
		}

		if (!getAllowedOrigins(port).has(parsedOrigin)) {
			return jsonRpcError(403, -32000, "Forbidden origin.");
		}
	}

	const token = process.env["OPENSCREEN_MCP_TOKEN"]?.trim();
	const authDisabled = process.env["OPENSCREEN_MCP_DISABLE_AUTH"] === "true";
	if (token && !authDisabled) {
		const authorization = getHeader(req, "authorization");
		if (authorization !== `Bearer ${token}`) {
			return jsonRpcError(401, -32001, "Missing or invalid MCP bearer token.");
		}
	}

	return null;
}

function isReadOnlyTool(name: string): boolean {
	return (
		name.endsWith(".get") ||
		name.endsWith(".list") ||
		name.endsWith(".state") ||
		name.endsWith(".current") ||
		name.endsWith(".snapshot") ||
		name.endsWith(".getOptions") ||
		name === "openscreen.sources.list" ||
		name === "openscreen.project.current" ||
		name === "openscreen.project.snapshot" ||
		name === "openscreen.media.current" ||
		name === "openscreen.preview.state" ||
		name === "openscreen.timeline.state" ||
		name === "openscreen.cursorTelemetry.get" ||
		name === "openscreen.export.settings.get" ||
		name === "openscreen.shortcuts.get" ||
		name === "openscreen.preferences.get" ||
		name === "openscreen.locale.get"
	);
}

function structuredContentFrom(value: unknown): JsonObject | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (value && typeof value === "object" && !Array.isArray(value)) {
		return value as JsonObject;
	}
	return { value };
}

function toCallToolResult(result: McpToolResult): CallToolResult {
	return {
		content: result.content,
		...(result.structuredContent !== undefined
			? { structuredContent: structuredContentFrom(result.structuredContent) }
			: {}),
		...(result.isError !== undefined ? { isError: result.isError } : {}),
	};
}

function createToolErrorResult(message: string): CallToolResult {
	return {
		content: [{ type: "text", text: message }],
		isError: true,
		structuredContent: {
			success: false,
			error: {
				code: "mcp_server_error",
				message,
			},
		},
	};
}

function createSdkServer(
	options: StartMcpServerOptions,
	resources: McpResourceDefinition[],
	runTool: (
		definition: McpToolDefinition<OpenScreenMcpToolContext>,
		args: unknown,
	) => Promise<CallToolResult>,
) {
	const server = new Server(
		{
			name: "openscreen",
			version: options.appVersion,
		},
		{
			capabilities: {
				tools: { listChanged: false },
				resources: { listChanged: false },
			},
			instructions:
				"Use these tools to inspect and control the local OpenScreen desktop app. Mutating tools are serialized by the app.",
		},
	);

	const toolDefinitions = mcpToolDefinitions as Array<McpToolDefinition<OpenScreenMcpToolContext>>;
	const toolsByName = new Map(toolDefinitions.map((definition) => [definition.name, definition]));
	const resourcesByUri = new Map(resources.map((resource) => [resource.uri, resource]));

	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: toolDefinitions.map((definition) => ({
			name: definition.name,
			title: definition.name.replace(/^openscreen\./, ""),
			description: `${definition.description}\n\nFeature document: ${definition.featureDocument}`,
			inputSchema: definition.inputSchema,
			annotations: {
				readOnlyHint: isReadOnlyTool(definition.name),
				destructiveHint: !isReadOnlyTool(definition.name),
				openWorldHint: false,
			},
		})),
	}));

	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const definition = toolsByName.get(request.params.name);
		if (!definition) {
			return createToolErrorResult(`Unknown tool: ${request.params.name}`);
		}

		return runTool(definition, request.params.arguments ?? {});
	});

	server.setRequestHandler(ListResourcesRequestSchema, async () => ({
		resources: resources.map((resource) => ({
			uri: resource.uri,
			name: resource.name,
			title: resource.name,
			description: resource.description,
			mimeType: resource.mimeType,
		})),
	}));

	server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
		const resource = resourcesByUri.get(request.params.uri);
		if (!resource) {
			throw new Error(`Unknown resource: ${request.params.uri}`);
		}

		const content = await resource.read();
		return {
			contents: [
				{
					uri: resource.uri,
					mimeType: resource.mimeType,
					text: JSON.stringify(content, null, 2),
				},
			],
		};
	});

	return server;
}

function listen(server: HttpServer, host: string, port: number): Promise<void> {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, host, () => {
			server.off("error", reject);
			resolve();
		});
	});
}

export async function startMcpServer(
	options: StartMcpServerOptions,
): Promise<McpHttpServerController> {
	const host = options.host ?? DEFAULT_HOST;
	const port = options.port ?? DEFAULT_PORT;
	const mcpPath = options.path ?? DEFAULT_PATH;
	const sessions = new Map<string, TransportSession>();
	const startedAt = new Date();
	let mutationQueue = Promise.resolve();
	let activePort = port;

	const runTool = async (
		definition: McpToolDefinition<OpenScreenMcpToolContext>,
		args: unknown,
	): Promise<CallToolResult> => {
		const invoke = async () => {
			try {
				return toCallToolResult(await definition.handler(args, options.context));
			} catch (error) {
				console.error(`[mcp] Tool failed: ${definition.name}`, error);
				return createToolErrorResult(String(error));
			}
		};

		if (isReadOnlyTool(definition.name)) {
			return invoke();
		}

		const next = mutationQueue.then(invoke, invoke);
		mutationQueue = next.then(
			() => undefined,
			() => undefined,
		);
		return next;
	};

	const httpServer = createServer(async (req, res) => {
		try {
			const url = new URL(req.url ?? "/", `http://${getHeader(req, "host") ?? `${host}:${port}`}`);
			if (url.pathname !== mcpPath) {
				sendJson(res, 404, { error: "Not found" });
				return;
			}

			const boundaryError = validateHttpBoundary(req, activePort);
			if (boundaryError) {
				sendJson(res, boundaryError.statusCode, boundaryError.body);
				return;
			}

			if (req.method === "POST") {
				const body = await parseJsonBody(req);
				const sessionId = getHeader(req, "mcp-session-id");

				if (sessionId) {
					const session = sessions.get(sessionId);
					if (!session) {
						const error = jsonRpcError(404, -32000, "MCP session not found.");
						sendJson(res, error.statusCode, error.body);
						return;
					}
					await session.transport.handleRequest(req, res, body);
					return;
				}

				if (!isInitializeRequest(body)) {
					const error = jsonRpcError(
						400,
						-32000,
						"Bad Request: initialize is required before session requests.",
					);
					sendJson(res, error.statusCode, error.body);
					return;
				}

				let transport!: StreamableHTTPServerTransport;
				const server = createSdkServer(options, options.resources, runTool);
				transport = new StreamableHTTPServerTransport({
					sessionIdGenerator: () => randomUUID(),
					onsessioninitialized: (initializedSessionId) => {
						sessions.set(initializedSessionId, {
							server,
							transport,
							createdAt: Date.now(),
						});
					},
				});
				transport.onclose = () => {
					const closedSessionId = transport.sessionId;
					if (closedSessionId) {
						sessions.delete(closedSessionId);
					}
				};

				await server.connect(transport);
				await transport.handleRequest(req, res, body);
				return;
			}

			if (req.method === "GET" || req.method === "DELETE") {
				const sessionId = getHeader(req, "mcp-session-id");
				const session = sessionId ? sessions.get(sessionId) : null;
				if (!session) {
					const error = jsonRpcError(400, -32000, "Invalid or missing MCP session ID.");
					sendJson(res, error.statusCode, error.body);
					return;
				}
				await session.transport.handleRequest(req, res);
				return;
			}

			const error = jsonRpcError(405, -32000, "Method not allowed.");
			sendJson(res, error.statusCode, error.body);
		} catch (error) {
			console.error("[mcp] HTTP request failed:", error);
			const response = jsonRpcError(500, -32603, "Internal MCP server error.");
			sendJson(res, response.statusCode, response.body);
		}
	});

	await listen(httpServer, host, port);
	const address = httpServer.address() as AddressInfo;
	activePort = address.port;
	const url = `http://${host}:${address.port}${mcpPath}`;

	return {
		url,
		getStatus: () => ({
			url,
			host,
			port: address.port,
			path: mcpPath,
			startedAt: startedAt.toISOString(),
			sessionCount: sessions.size,
			authRequired:
				Boolean(process.env["OPENSCREEN_MCP_TOKEN"]?.trim()) &&
				process.env["OPENSCREEN_MCP_DISABLE_AUTH"] !== "true",
		}),
		close: async () => {
			for (const session of Array.from(sessions.values())) {
				await session.server.close();
			}
			sessions.clear();
			await new Promise<void>((resolve, reject) => {
				httpServer.close((error) => {
					if (error) {
						reject(error);
						return;
					}
					resolve();
				});
			});
		},
	};
}
