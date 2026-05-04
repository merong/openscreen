export type JsonObject = Record<string, unknown>;

export type RendererCommandTarget = "hud" | "editor";

export interface RendererCommandBus {
	send<TResult = unknown>(
		target: RendererCommandTarget,
		method: string,
		args: unknown,
		options?: { timeoutMs?: number; ensureWindow?: boolean },
	): Promise<TResult>;
}

export interface ProcessedDesktopSource {
	id: string;
	name: string;
	display_id: string;
	thumbnail: string | null;
	appIcon: string | null;
}

export interface McpToolContent {
	type: "text";
	text: string;
}

export interface McpToolResult {
	content: McpToolContent[];
	structuredContent?: unknown;
	isError?: boolean;
}

export interface McpToolDefinition<TContext> {
	name: string;
	description: string;
	inputSchema: JsonObject;
	featureDocument: string;
	handler: (args: unknown, context: TContext) => Promise<McpToolResult>;
}

export function toolSuccess(structuredContent: unknown, message = "ok"): McpToolResult {
	return {
		content: [{ type: "text", text: message }],
		structuredContent,
	};
}

export function toolFailure(
	code: string,
	message: string,
	details?: Record<string, unknown>,
): McpToolResult {
	return {
		content: [{ type: "text", text: message }],
		isError: true,
		structuredContent: {
			success: false,
			error: {
				code,
				message,
				...(details ? { details } : {}),
			},
		},
	};
}
