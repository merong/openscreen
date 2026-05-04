import { SUPPORTED_LOCALES } from "../../src/i18n/config";
import type {
	McpToolDefinition,
	McpToolResult,
	ProcessedDesktopSource,
	RendererCommandBus,
} from "./toolTypes";
import { toolFailure, toolSuccess } from "./toolTypes";

const FEATURE_DOCUMENT = "docs/user-editable-features/01-recording-hud-and-source.md";
const SOURCE_TYPES = ["screen", "window"] as const;
const VIDEO_EXTENSIONS = new Set(["webm", "mp4", "mov", "avi", "mkv"]);

type SourceType = (typeof SOURCE_TYPES)[number];

interface BasicResult {
	success: boolean;
	message?: string;
	error?: string;
	canceled?: boolean;
	path?: string;
}

interface LoadProjectResult extends BasicResult {
	project?: unknown;
}

export interface RecordingHudToolContext {
	commandBus: RendererCommandBus;
	sources: {
		list: (options: Electron.SourcesOptions) => Promise<ProcessedDesktopSource[]>;
		select: (source: ProcessedDesktopSource) => Promise<ProcessedDesktopSource | null>;
		getSelected: () => Promise<ProcessedDesktopSource | null> | ProcessedDesktopSource | null;
	};
	media: {
		openVideoFilePicker: () => Promise<BasicResult>;
		setCurrentVideoPath?: (videoPath: string) => Promise<BasicResult>;
	};
	project: {
		loadProjectFile: () => Promise<LoadProjectResult>;
	};
	windows: {
		switchToEditor: () => Promise<unknown> | unknown;
	};
	locale?: {
		setMainLocale?: (locale: string) => Promise<unknown> | unknown;
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

function optionalFiniteNumber(args: Record<string, unknown>, key: string): number | undefined {
	const value = args[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeSourceTypes(value: unknown): SourceType[] {
	if (!Array.isArray(value)) {
		return ["screen", "window"];
	}

	const validTypes = value.filter((type): type is SourceType =>
		SOURCE_TYPES.includes(type as SourceType),
	);
	return validTypes.length > 0 ? [...new Set(validTypes)] : ["screen", "window"];
}

function normalizeSourcesOptions(args: unknown): Electron.SourcesOptions {
	const record = isRecord(args) ? args : {};
	const thumbnailWidth = optionalFiniteNumber(record, "thumbnailWidth");
	const thumbnailHeight = optionalFiniteNumber(record, "thumbnailHeight");
	const fetchWindowIcons = optionalBoolean(record, "fetchWindowIcons") ?? true;

	return {
		types: normalizeSourceTypes(record.types),
		fetchWindowIcons,
		...(thumbnailWidth || thumbnailHeight
			? {
					thumbnailSize: {
						width: Math.max(1, Math.round(thumbnailWidth ?? 320)),
						height: Math.max(1, Math.round(thumbnailHeight ?? 180)),
					},
				}
			: {}),
	};
}

function normalizeSource(value: unknown): ProcessedDesktopSource | null {
	if (!isRecord(value)) {
		return null;
	}

	const id = optionalString(value, "id");
	const name = optionalString(value, "name");
	if (!id || !name) {
		return null;
	}

	return {
		id,
		name,
		display_id: optionalString(value, "display_id") ?? "",
		thumbnail: typeof value.thumbnail === "string" ? value.thumbnail : null,
		appIcon: typeof value.appIcon === "string" ? value.appIcon : null,
	};
}

function getVideoExtension(value: string): string {
	const pathWithoutQuery = value.split(/[?#]/, 1)[0] ?? value;
	const segment = pathWithoutQuery.split(/[\\/]/).pop() ?? pathWithoutQuery;
	const extension = segment.includes(".") ? segment.split(".").pop() : "";
	return extension?.toLowerCase() ?? "";
}

function isSupportedVideoPath(videoPath: string): boolean {
	return VIDEO_EXTENSIONS.has(getVideoExtension(videoPath));
}

async function switchToEditor(context: RecordingHudToolContext): Promise<void> {
	await context.windows.switchToEditor();
}

export async function listSourcesTool(
	args: unknown,
	context: RecordingHudToolContext,
): Promise<McpToolResult> {
	const options = normalizeSourcesOptions(args);
	const sources = await context.sources.list(options);
	const selectedSource = await context.sources.getSelected();

	return toolSuccess(
		{
			success: true,
			sources,
			selectedSource,
			options,
		},
		`Found ${sources.length} source(s).`,
	);
}

export async function selectSourceTool(
	args: unknown,
	context: RecordingHudToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const sourceFromArgs = normalizeSource(record.source);
	let source = sourceFromArgs;

	if (!source) {
		const sourceId = optionalString(record, "sourceId");
		if (!sourceId) {
			return toolFailure("invalid_arguments", "Pass either sourceId or source.");
		}

		const sources = await context.sources.list({
			types: ["screen", "window"],
			fetchWindowIcons: true,
		});
		source = sources.find((candidate) => candidate.id === sourceId) ?? null;
		if (!source) {
			return toolFailure("source_not_found", `Source not found: ${sourceId}`, { sourceId });
		}
	}

	const selectedSource = await context.sources.select(source);
	return toolSuccess(
		{
			success: true,
			selectedSource,
		},
		`Selected source: ${selectedSource?.name ?? source.name}`,
	);
}

export async function setRecordingOptionsTool(
	args: unknown,
	context: RecordingHudToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const options = {
		systemAudioEnabled: optionalBoolean(record, "systemAudioEnabled"),
		microphoneEnabled: optionalBoolean(record, "microphoneEnabled"),
		microphoneDeviceId: optionalString(record, "microphoneDeviceId"),
		webcamEnabled: optionalBoolean(record, "webcamEnabled"),
		webcamDeviceId: optionalString(record, "webcamDeviceId"),
	};
	const hasOption = Object.values(options).some((value) => value !== undefined);

	if (!hasOption) {
		return toolFailure("invalid_arguments", "Pass at least one recording option to update.");
	}

	const result = await context.commandBus.send("hud", "recording.options.set", options, {
		ensureWindow: true,
		timeoutMs: 10_000,
	});
	return toolSuccess({ success: true, result }, "Recording options updated.");
}

export async function startRecordingTool(
	args: unknown,
	context: RecordingHudToolContext,
): Promise<McpToolResult> {
	const selectedSource = await context.sources.getSelected();
	if (!selectedSource) {
		return toolFailure("source_required", "Select a screen or window source before recording.", {
			needsUserAction: true,
			nextTools: ["openscreen.sources.list", "openscreen.sources.select"],
		});
	}

	const record = isRecord(args) ? args : {};
	const countdownSeconds = optionalFiniteNumber(record, "countdownSeconds");
	const result = await context.commandBus.send(
		"hud",
		"recording.start",
		{
			countdownSeconds:
				countdownSeconds === undefined ? 3 : Math.max(0, Math.round(countdownSeconds)),
		},
		{ ensureWindow: true, timeoutMs: 15_000 },
	);

	return toolSuccess({ success: true, selectedSource, result }, "Recording start requested.");
}

async function sendRecordingCommand(
	context: RecordingHudToolContext,
	method: string,
	message: string,
): Promise<McpToolResult> {
	const result = await context.commandBus.send(
		"hud",
		method,
		{},
		{
			ensureWindow: true,
			timeoutMs: 10_000,
		},
	);
	return toolSuccess({ success: true, result }, message);
}

export async function stopRecordingTool(
	_args: unknown,
	context: RecordingHudToolContext,
): Promise<McpToolResult> {
	return sendRecordingCommand(context, "recording.stop", "Recording stop requested.");
}

export async function pauseRecordingTool(
	_args: unknown,
	context: RecordingHudToolContext,
): Promise<McpToolResult> {
	return sendRecordingCommand(context, "recording.pause", "Recording pause requested.");
}

export async function resumeRecordingTool(
	_args: unknown,
	context: RecordingHudToolContext,
): Promise<McpToolResult> {
	return sendRecordingCommand(context, "recording.resume", "Recording resume requested.");
}

export async function restartRecordingTool(
	_args: unknown,
	context: RecordingHudToolContext,
): Promise<McpToolResult> {
	return sendRecordingCommand(context, "recording.restart", "Recording restart requested.");
}

export async function cancelRecordingTool(
	_args: unknown,
	context: RecordingHudToolContext,
): Promise<McpToolResult> {
	return sendRecordingCommand(context, "recording.cancel", "Recording cancel requested.");
}

export async function openVideoTool(
	args: unknown,
	context: RecordingHudToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const requestedPath = optionalString(record, "path");

	if (requestedPath) {
		if (!isSupportedVideoPath(requestedPath)) {
			return toolFailure("unsupported_video_type", "Unsupported video extension.", {
				supportedExtensions: [...VIDEO_EXTENSIONS].sort(),
			});
		}

		if (!context.media.setCurrentVideoPath) {
			return toolFailure(
				"approved_path_required",
				"Opening a path directly requires an approved-path media bridge.",
			);
		}

		const result = await context.media.setCurrentVideoPath(requestedPath);
		if (!result.success) {
			return toolFailure("open_video_failed", result.message ?? "Failed to open video.", {
				result,
			});
		}

		await switchToEditor(context);
		return toolSuccess({ success: true, path: requestedPath, result }, "Video opened.");
	}

	const pickerResult = await context.media.openVideoFilePicker();
	if (pickerResult.canceled) {
		return toolSuccess({ success: false, canceled: true }, "Open video canceled.");
	}
	if (!pickerResult.success || !pickerResult.path) {
		return toolFailure("open_video_failed", pickerResult.message ?? "Failed to open video.", {
			result: pickerResult,
		});
	}

	await switchToEditor(context);
	return toolSuccess(
		{
			success: true,
			path: pickerResult.path,
			result: pickerResult,
		},
		"Video opened.",
	);
}

export async function openProjectFromHudTool(
	_args: unknown,
	context: RecordingHudToolContext,
): Promise<McpToolResult> {
	const result = await context.project.loadProjectFile();
	if (result.canceled) {
		return toolSuccess({ success: false, canceled: true }, "Open project canceled.");
	}
	if (!result.success) {
		return toolFailure("open_project_failed", result.message ?? "Failed to open project.", {
			result,
		});
	}

	await switchToEditor(context);
	return toolSuccess(
		{
			success: true,
			path: result.path,
			project: result.project,
		},
		"Project opened.",
	);
}

export async function setLocaleTool(
	args: unknown,
	context: RecordingHudToolContext,
): Promise<McpToolResult> {
	const locale = optionalString(isRecord(args) ? args : {}, "locale");
	if (!locale || !SUPPORTED_LOCALES.includes(locale as (typeof SUPPORTED_LOCALES)[number])) {
		return toolFailure("unsupported_locale", "Unsupported locale.", {
			supportedLocales: [...SUPPORTED_LOCALES],
		});
	}

	const result = await context.commandBus.send(
		"hud",
		"locale.set",
		{ locale },
		{
			ensureWindow: true,
			timeoutMs: 10_000,
		},
	);
	await context.locale?.setMainLocale?.(locale);

	return toolSuccess({ success: true, locale, result }, `Locale set to ${locale}.`);
}

const processedSourceSchema = {
	type: "object",
	required: ["id", "name"],
	properties: {
		id: { type: "string" },
		name: { type: "string" },
		display_id: { type: "string" },
		thumbnail: { type: ["string", "null"] },
		appIcon: { type: ["string", "null"] },
	},
} as const;

export const recordingHudToolDefinitions: McpToolDefinition<RecordingHudToolContext>[] = [
	{
		name: "openscreen.sources.list",
		description: "List screen/window recording sources visible to OpenScreen.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			properties: {
				types: { type: "array", items: { enum: SOURCE_TYPES } },
				thumbnailWidth: { type: "number", minimum: 1 },
				thumbnailHeight: { type: "number", minimum: 1 },
				fetchWindowIcons: { type: "boolean" },
			},
			additionalProperties: false,
		},
		handler: listSourcesTool,
	},
	{
		name: "openscreen.sources.select",
		description: "Select the screen/window source used by subsequent recording starts.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			properties: {
				sourceId: { type: "string" },
				source: processedSourceSchema,
			},
			additionalProperties: false,
		},
		handler: selectSourceTool,
	},
	{
		name: "openscreen.recording.options.set",
		description: "Configure system audio, microphone, and webcam options in the HUD renderer.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			properties: {
				systemAudioEnabled: { type: "boolean" },
				microphoneEnabled: { type: "boolean" },
				microphoneDeviceId: { type: "string" },
				webcamEnabled: { type: "boolean" },
				webcamDeviceId: { type: "string" },
			},
			additionalProperties: false,
		},
		handler: setRecordingOptionsTool,
	},
	{
		name: "openscreen.recording.start",
		description: "Start recording through the HUD renderer after a source has been selected.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			properties: {
				countdownSeconds: { type: "number", minimum: 0 },
			},
			additionalProperties: false,
		},
		handler: startRecordingTool,
	},
	{
		name: "openscreen.recording.stop",
		description: "Stop the current recording and keep the saved recording session.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		handler: stopRecordingTool,
	},
	{
		name: "openscreen.recording.pause",
		description: "Pause the active screen and webcam MediaRecorder instances.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		handler: pauseRecordingTool,
	},
	{
		name: "openscreen.recording.resume",
		description: "Resume the paused screen and webcam MediaRecorder instances.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		handler: resumeRecordingTool,
	},
	{
		name: "openscreen.recording.restart",
		description: "Discard the active recording and immediately start a replacement recording.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		handler: restartRecordingTool,
	},
	{
		name: "openscreen.recording.cancel",
		description: "Cancel the active recording or countdown and discard cursor telemetry.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		handler: cancelRecordingTool,
	},
	{
		name: "openscreen.media.openVideo",
		description: "Open an existing video through the approved OpenScreen media path flow.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			properties: {
				path: { type: "string" },
			},
			additionalProperties: false,
		},
		handler: openVideoTool,
	},
	{
		name: "openscreen.project.openFromHud",
		description: "Open a project using the HUD project picker and switch to the editor.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		handler: openProjectFromHudTool,
	},
	{
		name: "openscreen.locale.set",
		description: "Set the HUD language through the renderer i18n provider.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			required: ["locale"],
			properties: {
				locale: { enum: SUPPORTED_LOCALES },
			},
			additionalProperties: false,
		},
		handler: setLocaleTool,
	},
];
