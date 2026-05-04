import type { OpenScreenMcpToolContext } from "./tools";

export interface McpResourceDefinition {
	uri: string;
	name: string;
	description: string;
	mimeType: "application/json";
	read: () => Promise<unknown>;
}

export interface OpenScreenMcpResourceContext {
	app: {
		getVersion: () => string;
		getName: () => string;
	};
	windows: {
		getStatus: () => Record<string, unknown>;
	};
	tools: OpenScreenMcpToolContext;
	server: {
		getStatus: () => Record<string, unknown>;
	};
}

async function readOptionalRendererResource(
	context: OpenScreenMcpToolContext,
	targetMethod: string,
	args: Record<string, unknown> = {},
) {
	try {
		return await context.commandBus.send("editor", targetMethod, args, {
			ensureWindow: false,
			timeoutMs: 5_000,
		});
	} catch (error) {
		return {
			success: false,
			available: false,
			message: String(error),
		};
	}
}

export function createOpenScreenMcpResources(
	context: OpenScreenMcpResourceContext,
): McpResourceDefinition[] {
	return [
		{
			uri: "openscreen://app/status",
			name: "app-status",
			description: "OpenScreen app, MCP server, and window status.",
			mimeType: "application/json",
			read: async () => ({
				success: true,
				app: {
					name: context.app.getName(),
					version: context.app.getVersion(),
					platform: process.platform,
				},
				mcp: context.server.getStatus(),
				windows: context.windows.getStatus(),
			}),
		},
		{
			uri: "openscreen://sources",
			name: "sources",
			description: "Available recording sources and the currently selected source.",
			mimeType: "application/json",
			read: async () => ({
				success: true,
				sources: await context.tools.sources.list({
					types: ["screen", "window"],
					fetchWindowIcons: false,
				}),
				selectedSource: await context.tools.sources.getSelected(),
			}),
		},
		{
			uri: "openscreen://recording/session",
			name: "recording-session",
			description: "Current recording session and latest recording path metadata.",
			mimeType: "application/json",
			read: async () => ({
				success: true,
				current: context.tools.media.getCurrentRecordingSession
					? await context.tools.media.getCurrentRecordingSession()
					: null,
			}),
		},
		{
			uri: "openscreen://project/current",
			name: "current-project",
			description: "Current editor project state when the editor renderer is available.",
			mimeType: "application/json",
			read: async () => readOptionalRendererResource(context.tools, "project.current.get"),
		},
		{
			uri: "openscreen://editor/state",
			name: "editor-state",
			description: "Current timeline, preview, and selection state.",
			mimeType: "application/json",
			read: async () => readOptionalRendererResource(context.tools, "timeline.state.get"),
		},
		{
			uri: "openscreen://export/progress",
			name: "export-progress",
			description: "Current export settings and progress when the editor is available.",
			mimeType: "application/json",
			read: async () =>
				readOptionalRendererResource(context.tools, "export.settings.get", {
					includeCalculatedGifDimensions: true,
					includeProgress: true,
				}),
		},
		{
			uri: "openscreen://shortcuts",
			name: "shortcuts",
			description: "Persisted configurable keyboard shortcuts.",
			mimeType: "application/json",
			read: async () => ({
				success: true,
				shortcuts: await context.tools.shortcuts.getShortcuts(),
			}),
		},
		{
			uri: "openscreen://preferences",
			name: "preferences",
			description: "Renderer-local user preferences when the editor is available.",
			mimeType: "application/json",
			read: async () =>
				readOptionalRendererResource(context.tools, "preferences.get", {
					includeAllowed: true,
				}),
		},
	];
}
