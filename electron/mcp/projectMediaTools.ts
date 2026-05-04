import {
	createProjectSnapshot,
	normalizeProjectEditor,
	type ProjectEditorState,
} from "../../src/components/video-editor/projectPersistence";
import {
	normalizeProjectMedia,
	normalizeRecordingSession,
	type ProjectMedia,
	type RecordingSession,
} from "../../src/lib/recordingSession";
import type { McpToolDefinition, McpToolResult, RendererCommandBus } from "./toolTypes";
import { toolFailure, toolSuccess } from "./toolTypes";

const FEATURE_DOCUMENT = "docs/user-editable-features/02-project-and-media.md";

interface BasicResult {
	success: boolean;
	message?: string;
	error?: string;
	canceled?: boolean;
	path?: string;
}

interface CurrentRecordingSessionResult extends BasicResult {
	session?: RecordingSession;
}

export interface ProjectMediaToolContext {
	commandBus: RendererCommandBus;
	project: {
		startNewRecording: () => Promise<BasicResult> | BasicResult;
	};
	media: {
		getCurrentRecordingSession?: () =>
			| Promise<CurrentRecordingSessionResult>
			| CurrentRecordingSessionResult;
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function optionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
	const value = args[key];
	return typeof value === "boolean" ? value : undefined;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
	const value = args[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseEditorArgs(args: unknown): Record<string, unknown> | null {
	if (!isRecord(args)) {
		return null;
	}

	const editor = isRecord(args.editor) ? args.editor : null;
	if (editor) {
		return editor;
	}

	const patch = isRecord(args.patch) ? args.patch : null;
	return patch;
}

function parseMediaArgs(args: unknown): ProjectMedia | null {
	if (!isRecord(args)) {
		return null;
	}
	return normalizeProjectMedia(args.media);
}

async function sendEditorCommand(
	context: ProjectMediaToolContext,
	method: string,
	args: unknown,
	timeoutMs = 10_000,
): Promise<unknown> {
	return context.commandBus.send("editor", method, args, {
		ensureWindow: true,
		timeoutMs,
	});
}

export async function getCurrentProjectTool(
	_args: unknown,
	context: ProjectMediaToolContext,
): Promise<McpToolResult> {
	const result = await sendEditorCommand(context, "project.current.get", {}, 10_000);
	return toolSuccess({ success: true, result }, "Current project loaded.");
}

export async function getProjectSnapshotTool(
	_args: unknown,
	context: ProjectMediaToolContext,
): Promise<McpToolResult> {
	const result = await sendEditorCommand(context, "project.snapshot.get", {}, 10_000);
	return toolSuccess({ success: true, result }, "Current project snapshot loaded.");
}

export async function saveProjectTool(
	_args: unknown,
	context: ProjectMediaToolContext,
): Promise<McpToolResult> {
	const result = await sendEditorCommand(context, "project.save", { forceSaveAs: false }, 60_000);
	return toolSuccess({ success: true, result }, "Project save requested.");
}

export async function saveProjectAsTool(
	_args: unknown,
	context: ProjectMediaToolContext,
): Promise<McpToolResult> {
	const result = await sendEditorCommand(context, "project.save", { forceSaveAs: true }, 60_000);
	return toolSuccess({ success: true, result }, "Project save-as requested.");
}

export async function loadProjectTool(
	_args: unknown,
	context: ProjectMediaToolContext,
): Promise<McpToolResult> {
	const result = await sendEditorCommand(context, "project.load", {}, 60_000);
	return toolSuccess({ success: true, result }, "Project load requested.");
}

export async function applyEditorStateTool(
	args: unknown,
	context: ProjectMediaToolContext,
): Promise<McpToolResult> {
	const editorInput = parseEditorArgs(args);
	if (!editorInput) {
		return toolFailure(
			"invalid_arguments",
			"Pass a project editor state object as editor or patch.",
		);
	}

	const record = isRecord(args) ? args : {};
	const media = parseMediaArgs(record);
	const replace = optionalBoolean(record, "replace") ?? true;
	const commit = optionalBoolean(record, "commit") ?? true;
	const source = optionalString(record, "source") ?? "mcp";
	const normalizedEditor = normalizeProjectEditor(editorInput as Partial<ProjectEditorState>);
	const snapshot = media ? createProjectSnapshot(media, normalizedEditor) : null;

	const result = await sendEditorCommand(
		context,
		"project.applyEditorState",
		{
			editor: normalizedEditor,
			replace,
			commit,
			source,
			...(media ? { media } : {}),
		},
		30_000,
	);

	return toolSuccess(
		{
			success: true,
			editor: normalizedEditor,
			media,
			snapshot,
			result,
		},
		"Project editor state applied.",
	);
}

export async function startNewRecordingTool(
	_args: unknown,
	context: ProjectMediaToolContext,
): Promise<McpToolResult> {
	const result = await context.project.startNewRecording();
	if (!result.success) {
		return toolFailure("start_new_recording_failed", result.message ?? result.error ?? "Failed.", {
			result,
		});
	}

	return toolSuccess({ success: true, result }, "New recording flow started.");
}

export async function getCurrentMediaTool(
	args: unknown,
	context: ProjectMediaToolContext,
): Promise<McpToolResult> {
	const preferRenderer = optionalBoolean(isRecord(args) ? args : {}, "preferRenderer") ?? true;
	let rendererResult: unknown = null;
	let rendererError: string | null = null;

	if (preferRenderer) {
		try {
			rendererResult = await context.commandBus.send(
				"editor",
				"media.current.get",
				{},
				{
					ensureWindow: false,
					timeoutMs: 5_000,
				},
			);
		} catch (error) {
			rendererError = String(error);
		}
	}

	const mainResult = context.media.getCurrentRecordingSession
		? await context.media.getCurrentRecordingSession()
		: null;
	const normalizedMainSession = mainResult?.session
		? normalizeRecordingSession(mainResult.session)
		: null;

	return toolSuccess(
		{
			success: true,
			renderer: rendererResult,
			main: {
				...mainResult,
				session: normalizedMainSession ?? undefined,
			},
			...(rendererError ? { rendererError } : {}),
		},
		"Current media loaded.",
	);
}

const editorStateSchema = {
	type: "object",
	description:
		"ProjectEditorState-compatible object. The tool normalizes it with normalizeProjectEditor before dispatch.",
	additionalProperties: true,
} as const;

const mediaSchema = {
	type: "object",
	required: ["screenVideoPath"],
	properties: {
		screenVideoPath: { type: "string" },
		webcamVideoPath: { type: "string" },
	},
	additionalProperties: false,
} as const;

export const projectMediaToolDefinitions: McpToolDefinition<ProjectMediaToolContext>[] = [
	{
		name: "openscreen.project.current",
		description:
			"Read the current project media, editor state, export settings, and unsaved status.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		handler: getCurrentProjectTool,
	},
	{
		name: "openscreen.project.snapshot",
		description: "Read the normalized current project snapshot used for unsaved-change tracking.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		handler: getProjectSnapshotTool,
	},
	{
		name: "openscreen.project.save",
		description: "Save the current project through the editor saveProject(false) flow.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		handler: saveProjectTool,
	},
	{
		name: "openscreen.project.saveAs",
		description: "Save the current project through the editor saveProject(true) flow.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		handler: saveProjectAsTool,
	},
	{
		name: "openscreen.project.load",
		description: "Load a project through the editor applyLoadedProject path.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		handler: loadProjectTool,
	},
	{
		name: "openscreen.project.applyEditorState",
		description:
			"Normalize and apply a complete ProjectEditorState through the editor command layer.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			properties: {
				editor: editorStateSchema,
				patch: editorStateSchema,
				media: mediaSchema,
				replace: { type: "boolean" },
				commit: { type: "boolean" },
				source: { type: "string" },
			},
			additionalProperties: false,
		},
		handler: applyEditorStateTool,
	},
	{
		name: "openscreen.project.startNewRecording",
		description: "Clear the current session and return to the HUD to begin a new recording.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		handler: startNewRecordingTool,
	},
	{
		name: "openscreen.media.current",
		description: "Read current media from the editor when available and from main recording state.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			properties: {
				preferRenderer: { type: "boolean" },
			},
			additionalProperties: false,
		},
		handler: getCurrentMediaTool,
	},
];
