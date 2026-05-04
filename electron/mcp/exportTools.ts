import type {
	ExportFormat,
	ExportQuality,
	GifFrameRate,
	GifSizePreset,
} from "../../src/lib/exporter";
import type { McpToolDefinition, McpToolResult, RendererCommandBus } from "./toolTypes";
import { toolFailure, toolSuccess } from "./toolTypes";

const FEATURE_DOCUMENT = "docs/user-editable-features/10-export-settings.md";
const EXPORT_FORMATS = ["mp4", "gif"] as const;
const EXPORT_QUALITIES = ["medium", "good", "source"] as const;
const GIF_FRAME_RATES = [15, 20, 25, 30] as const;
const GIF_SIZE_PRESETS = ["medium", "large", "original"] as const;
const EXPORT_TIMEOUT_MS = 3_600_000;

interface BasicResult {
	success: boolean;
	message?: string;
	error?: string;
	canceled?: boolean;
	path?: string;
}

interface ExportSettingsPatch {
	exportFormat?: ExportFormat;
	exportQuality?: ExportQuality;
	gifFrameRate?: GifFrameRate;
	gifLoop?: boolean;
	gifSizePreset?: GifSizePreset;
}

export interface ExportToolContext {
	commandBus: RendererCommandBus;
	files?: {
		revealInFolder?: (filePath: string) => Promise<BasicResult> | BasicResult;
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

function normalizeExportFormat(value: unknown): ExportFormat | null {
	return EXPORT_FORMATS.includes(value as ExportFormat) ? (value as ExportFormat) : null;
}

function normalizeExportQuality(value: unknown): ExportQuality | null {
	return EXPORT_QUALITIES.includes(value as ExportQuality) ? (value as ExportQuality) : null;
}

function normalizeGifFrameRate(value: unknown): GifFrameRate | null {
	return GIF_FRAME_RATES.includes(value as GifFrameRate) ? (value as GifFrameRate) : null;
}

function normalizeGifSizePreset(value: unknown): GifSizePreset | null {
	return GIF_SIZE_PRESETS.includes(value as GifSizePreset) ? (value as GifSizePreset) : null;
}

function hasSettingInput(record: Record<string, unknown>): boolean {
	const source = isRecord(record.settings) ? record.settings : record;
	const gifConfig = isRecord(source.gifConfig) ? source.gifConfig : {};
	return [
		"format",
		"exportFormat",
		"quality",
		"exportQuality",
		"frameRate",
		"gifFrameRate",
		"loop",
		"gifLoop",
		"sizePreset",
		"gifSizePreset",
	].some((key) => key in source || key in gifConfig);
}

function normalizeExportSettingsPatch(
	args: unknown,
	options: { requireAny: boolean },
): { patch: ExportSettingsPatch; hasInput: boolean } | { error: McpToolResult } {
	const record = isRecord(args) ? args : {};
	const source = isRecord(record.settings) ? record.settings : record;
	const gifConfig = isRecord(source.gifConfig) ? source.gifConfig : {};
	const hasInput = hasSettingInput(record);
	const patch: ExportSettingsPatch = {};

	if ("format" in source || "exportFormat" in source) {
		const exportFormat = normalizeExportFormat(source.format ?? source.exportFormat);
		if (!exportFormat) {
			return {
				error: toolFailure("invalid_export_format", "Pass format/exportFormat as mp4 or gif.", {
					formats: [...EXPORT_FORMATS],
				}),
			};
		}
		patch.exportFormat = exportFormat;
	}

	if ("quality" in source || "exportQuality" in source) {
		const exportQuality = normalizeExportQuality(source.quality ?? source.exportQuality);
		if (!exportQuality) {
			return {
				error: toolFailure(
					"invalid_export_quality",
					"Pass quality/exportQuality as medium, good, or source.",
					{ qualities: [...EXPORT_QUALITIES] },
				),
			};
		}
		patch.exportQuality = exportQuality;
	}

	if ("frameRate" in source || "gifFrameRate" in source || "frameRate" in gifConfig) {
		const gifFrameRate = normalizeGifFrameRate(
			source.frameRate ?? source.gifFrameRate ?? gifConfig.frameRate,
		);
		if (!gifFrameRate) {
			return {
				error: toolFailure(
					"invalid_gif_frame_rate",
					"Pass gifFrameRate/frameRate as 15, 20, 25, or 30.",
					{ frameRates: [...GIF_FRAME_RATES] },
				),
			};
		}
		patch.gifFrameRate = gifFrameRate;
	}

	if ("loop" in source || "gifLoop" in source || "loop" in gifConfig) {
		const gifLoop =
			optionalBoolean(source, "loop") ??
			optionalBoolean(source, "gifLoop") ??
			optionalBoolean(gifConfig, "loop");
		if (gifLoop === undefined) {
			return {
				error: toolFailure("invalid_gif_loop", "Pass gifLoop/loop as a boolean."),
			};
		}
		patch.gifLoop = gifLoop;
	}

	if ("sizePreset" in source || "gifSizePreset" in source || "sizePreset" in gifConfig) {
		const gifSizePreset = normalizeGifSizePreset(
			source.sizePreset ?? source.gifSizePreset ?? gifConfig.sizePreset,
		);
		if (!gifSizePreset) {
			return {
				error: toolFailure(
					"invalid_gif_size_preset",
					"Pass gifSizePreset/sizePreset as medium, large, or original.",
					{ sizePresets: [...GIF_SIZE_PRESETS] },
				),
			};
		}
		patch.gifSizePreset = gifSizePreset;
	}

	if (options.requireAny && !hasInput) {
		return {
			error: toolFailure("missing_export_settings", "Pass at least one export setting to change."),
		};
	}

	return { patch, hasInput };
}

function rejectUnsupportedSaveTarget(record: Record<string, unknown>): McpToolResult | null {
	const saveMode = optionalString(record, "saveMode") ?? "dialog";
	if (saveMode !== "dialog") {
		return toolFailure(
			"unsupported_save_mode",
			"Only saveMode: dialog is supported by the current export flow.",
			{ supportedSaveModes: ["dialog"] },
		);
	}

	const requestedPath =
		optionalString(record, "filePath") ??
		optionalString(record, "outputPath") ??
		optionalString(record, "path");
	if (requestedPath) {
		return toolFailure(
			"unsupported_noninteractive_export_path",
			"Export currently uses the Electron save dialog; direct path writes need a separate IPC.",
			{ requestedPath },
		);
	}

	return null;
}

async function sendExportCommand(
	context: ExportToolContext,
	method: string,
	args: unknown,
	timeoutMs = 10_000,
): Promise<unknown> {
	return context.commandBus.send("editor", method, args, {
		ensureWindow: true,
		timeoutMs,
	});
}

export async function getExportSettingsTool(
	args: unknown,
	context: ExportToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const includeCalculatedGifDimensions =
		optionalBoolean(record, "includeCalculatedGifDimensions") ?? true;
	const includeProgress = optionalBoolean(record, "includeProgress") ?? true;
	const result = await sendExportCommand(context, "export.settings.get", {
		includeCalculatedGifDimensions,
		includeProgress,
	});

	return toolSuccess(
		{
			success: true,
			includeCalculatedGifDimensions,
			includeProgress,
			allowed: {
				formats: [...EXPORT_FORMATS],
				qualities: [...EXPORT_QUALITIES],
				gifFrameRates: [...GIF_FRAME_RATES],
				gifSizePresets: [...GIF_SIZE_PRESETS],
				saveModes: ["dialog"],
			},
			result,
		},
		"Export settings loaded.",
	);
}

export async function setExportSettingsTool(
	args: unknown,
	context: ExportToolContext,
): Promise<McpToolResult> {
	const normalized = normalizeExportSettingsPatch(args, { requireAny: true });
	if ("error" in normalized) {
		return normalized.error;
	}

	const record = isRecord(args) ? args : {};
	const persistToPreferences = optionalBoolean(record, "persistToPreferences") ?? true;
	const commit = optionalBoolean(record, "commit") ?? true;
	const result = await sendExportCommand(context, "export.settings.set", {
		patch: normalized.patch,
		persistToPreferences,
		commit,
	});

	return toolSuccess(
		{
			success: true,
			patch: normalized.patch,
			persistToPreferences,
			commit,
			result,
		},
		"Export settings set.",
	);
}

export async function startExportTool(
	args: unknown,
	context: ExportToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const unsupportedSaveTarget = rejectUnsupportedSaveTarget(record);
	if (unsupportedSaveTarget) {
		return unsupportedSaveTarget;
	}

	const normalized = normalizeExportSettingsPatch(args, { requireAny: false });
	if ("error" in normalized) {
		return normalized.error;
	}

	const result = await sendExportCommand(
		context,
		"export.start",
		{
			settings: normalized.patch,
			useCurrentSettings: !normalized.hasInput,
			requireVideo: true,
			saveMode: "dialog",
		},
		EXPORT_TIMEOUT_MS,
	);

	return toolSuccess(
		{
			success: true,
			settings: normalized.patch,
			useCurrentSettings: !normalized.hasInput,
			requireVideo: true,
			saveMode: "dialog",
			pendingBlobMayRemainOnSaveCancel: true,
			result,
		},
		"Export start requested.",
	);
}

export async function cancelExportTool(
	_args: unknown,
	context: ExportToolContext,
): Promise<McpToolResult> {
	const result = await sendExportCommand(context, "export.cancel", { allowNoop: true });
	return toolSuccess({ success: true, allowNoop: true, result }, "Export cancel requested.");
}

export async function savePendingExportTool(
	_args: unknown,
	context: ExportToolContext,
): Promise<McpToolResult> {
	const result = await sendExportCommand(
		context,
		"export.savePending",
		{ saveMode: "dialog" },
		60_000,
	);
	return toolSuccess(
		{
			success: true,
			saveMode: "dialog",
			pendingBlobRequired: true,
			result,
		},
		"Pending export save requested.",
	);
}

export async function revealExportTool(
	args: unknown,
	context: ExportToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const filePath = optionalString(record, "filePath") ?? optionalString(record, "path");
	if (!filePath) {
		return toolFailure("missing_file_path", "Pass filePath for the exported file.");
	}

	const revealInFolder = context.files?.revealInFolder;
	if (!revealInFolder) {
		return toolFailure(
			"reveal_service_unavailable",
			"files.revealInFolder is not available in this MCP context.",
		);
	}

	const result = await revealInFolder(filePath);
	if (!result.success) {
		return toolFailure(
			"reveal_failed",
			result.message ?? result.error ?? "Failed to reveal file.",
			{
				filePath,
				result,
			},
		);
	}

	return toolSuccess({ success: true, filePath, result }, "Export file revealed.");
}

const exportPatchProperties = {
	format: { enum: EXPORT_FORMATS },
	exportFormat: { enum: EXPORT_FORMATS },
	quality: { enum: EXPORT_QUALITIES },
	exportQuality: { enum: EXPORT_QUALITIES },
	frameRate: { enum: GIF_FRAME_RATES },
	gifFrameRate: { enum: GIF_FRAME_RATES },
	loop: { type: "boolean" },
	gifLoop: { type: "boolean" },
	sizePreset: { enum: GIF_SIZE_PRESETS },
	gifSizePreset: { enum: GIF_SIZE_PRESETS },
} as const;

const gifConfigSchema = {
	type: "object",
	properties: {
		frameRate: { enum: GIF_FRAME_RATES },
		loop: { type: "boolean" },
		sizePreset: { enum: GIF_SIZE_PRESETS },
	},
	additionalProperties: false,
} as const;

const settingsSchema = {
	type: "object",
	properties: {
		...exportPatchProperties,
		gifConfig: gifConfigSchema,
	},
	additionalProperties: false,
} as const;

export const exportToolDefinitions: McpToolDefinition<ExportToolContext>[] = [
	{
		name: "openscreen.export.settings.get",
		description: "Read export settings, allowed values, progress, and calculated GIF dimensions.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			properties: {
				includeCalculatedGifDimensions: { type: "boolean" },
				includeProgress: { type: "boolean" },
			},
			additionalProperties: false,
		},
		handler: getExportSettingsTool,
	},
	{
		name: "openscreen.export.settings.set",
		description: "Set MP4/GIF export settings and optionally persist preference-backed values.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			properties: {
				...exportPatchProperties,
				gifConfig: gifConfigSchema,
				settings: settingsSchema,
				persistToPreferences: { type: "boolean" },
				commit: { type: "boolean" },
			},
			additionalProperties: false,
		},
		handler: setExportSettingsTool,
	},
	{
		name: "openscreen.export.start",
		description: "Start renderer export using current media and the Electron save dialog flow.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			properties: {
				...exportPatchProperties,
				gifConfig: gifConfigSchema,
				settings: settingsSchema,
				saveMode: { enum: ["dialog"] },
			},
			additionalProperties: false,
		},
		handler: startExportTool,
	},
	{
		name: "openscreen.export.cancel",
		description: "Cancel the active MP4/GIF exporter; no-op when no export is running.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
		handler: cancelExportTool,
	},
	{
		name: "openscreen.export.savePending",
		description: "Open the save dialog for a pending export blob after an earlier save cancel.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
		handler: savePendingExportTool,
	},
	{
		name: "openscreen.export.reveal",
		description: "Reveal a saved export path in the platform file manager.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			properties: {
				filePath: { type: "string" },
				path: { type: "string" },
			},
			additionalProperties: false,
		},
		handler: revealExportTool,
	},
];
