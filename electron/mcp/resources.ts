import { readFile } from "node:fs/promises";
import path from "node:path";
import type { OpenScreenMcpToolContext } from "./tools";

type McpResourceMimeType = "application/json" | "text/markdown";

const EDITABLE_FEATURE_DOCUMENTS = [
	{
		uri: "openscreen://editing/features/recording-hud-and-source",
		name: "recording-hud-and-source",
		description: "Recording HUD, source selection, and input device editing feature guide.",
		path: "user-editable-features/01-recording-hud-and-source.md",
	},
	{
		uri: "openscreen://editing/features/project-and-media",
		name: "project-and-media",
		description: "Project, media, saved state, and approved media path feature guide.",
		path: "user-editable-features/02-project-and-media.md",
	},
	{
		uri: "openscreen://editing/features/timeline-editing",
		name: "timeline-editing",
		description: "Timeline, zoom, trim, speed, annotation span, blur span, and keyframe guide.",
		path: "user-editable-features/03-timeline-editing.md",
	},
	{
		uri: "openscreen://editing/features/preview-direct-editing",
		name: "preview-direct-editing",
		description: "Preview direct manipulation, positions, sizes, and focus editing guide.",
		path: "user-editable-features/04-preview-direct-editing.md",
	},
	{
		uri: "openscreen://editing/features/layout-effects-background",
		name: "layout-effects-background",
		description: "Layout, background, padding, shadow, blur, and webcam presentation guide.",
		path: "user-editable-features/05-layout-effects-background.md",
	},
	{
		uri: "openscreen://editing/features/crop-editing",
		name: "crop-editing",
		description: "Crop editing, pixel input, aspect ratio preset, and lock guide.",
		path: "user-editable-features/06-crop-editing.md",
	},
	{
		uri: "openscreen://editing/features/cursor-highlight",
		name: "cursor-highlight",
		description: "Cursor highlight style, size, color, click display, and offset guide.",
		path: "user-editable-features/07-cursor-highlight.md",
	},
	{
		uri: "openscreen://editing/features/annotation-editing",
		name: "annotation-editing",
		description: "Text, image, arrow, custom font, duplicate, and delete annotation guide.",
		path: "user-editable-features/08-annotation-editing.md",
	},
	{
		uri: "openscreen://editing/features/blur-and-mosaic",
		name: "blur-and-mosaic",
		description: "Blur, mosaic, shape, color, intensity, block size, and delete guide.",
		path: "user-editable-features/09-blur-and-mosaic.md",
	},
	{
		uri: "openscreen://editing/features/export-settings",
		name: "export-settings",
		description: "MP4 and GIF export settings, progress, cancel, and reveal guide.",
		path: "user-editable-features/10-export-settings.md",
	},
	{
		uri: "openscreen://editing/features/shortcuts-preferences-language",
		name: "shortcuts-preferences-language",
		description: "Shortcuts, preferences, custom fonts, and language guide.",
		path: "user-editable-features/11-shortcuts-preferences-language.md",
	},
] as const;

export interface McpResourceDefinition {
	uri: string;
	name: string;
	description: string;
	mimeType: McpResourceMimeType;
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
	docsRoot?: string;
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

function getDefaultDocsRoot(): string {
	return path.join(process.env["APP_ROOT"] ?? process.cwd(), "docs");
}

async function readMarkdownDocument(
	docsRoot: string | undefined,
	relativePath: string,
): Promise<string> {
	const root = path.resolve(docsRoot ?? getDefaultDocsRoot());
	const filePath = path.resolve(root, relativePath);
	if (!filePath.startsWith(`${root}${path.sep}`) && filePath !== root) {
		throw new Error(`Document path escapes docs root: ${relativePath}`);
	}
	return readFile(filePath, "utf-8");
}

export function createOpenScreenMcpResources(
	context: OpenScreenMcpResourceContext,
): McpResourceDefinition[] {
	return [
		{
			uri: "openscreen://editing/guide",
			name: "mcp-editing-guide",
			description:
				"Scenario-writing and execution guide for editing videos through OpenScreen MCP.",
			mimeType: "text/markdown",
			read: async () => readMarkdownDocument(context.docsRoot, "mcp-editing-guide.md"),
		},
		{
			uri: "openscreen://editing/feature-index",
			name: "editable-feature-index",
			description: "Index of OpenScreen user-editable feature documents referenced by MCP tools.",
			mimeType: "text/markdown",
			read: async () => readMarkdownDocument(context.docsRoot, "user-editable-features.md"),
		},
		...EDITABLE_FEATURE_DOCUMENTS.map((document) => ({
			uri: document.uri,
			name: document.name,
			description: document.description,
			mimeType: "text/markdown" as const,
			read: async () => readMarkdownDocument(context.docsRoot, document.path),
		})),
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
