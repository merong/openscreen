import { type CropRegion, DEFAULT_CROP_REGION } from "../../src/components/video-editor/types";
import type { McpToolDefinition, McpToolResult, RendererCommandBus } from "./toolTypes";
import { toolFailure, toolSuccess } from "./toolTypes";

const FEATURE_DOCUMENT = "docs/user-editable-features/06-crop-editing.md";
const MIN_PROJECT_CROP_SIZE = 0.01;
const CROP_ASPECT_PRESETS = ["16:9", "9:16", "4:3", "3:4", "1:1", "21:9"] as const;

type CropAspectPreset = (typeof CROP_ASPECT_PRESETS)[number];

export interface CropToolContext {
	commandBus: RendererCommandBus;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function optionalFiniteNumber(args: Record<string, unknown>, key: string): number | undefined {
	const value = args[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
	const value = args[key];
	return typeof value === "boolean" ? value : undefined;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function normalizeCropRegion(value: unknown): CropRegion | null {
	if (!isRecord(value)) {
		return null;
	}

	const rawX = optionalFiniteNumber(value, "x") ?? DEFAULT_CROP_REGION.x;
	const rawY = optionalFiniteNumber(value, "y") ?? DEFAULT_CROP_REGION.y;
	const rawWidth = optionalFiniteNumber(value, "width") ?? DEFAULT_CROP_REGION.width;
	const rawHeight = optionalFiniteNumber(value, "height") ?? DEFAULT_CROP_REGION.height;

	const x = clamp(rawX, 0, 1);
	const y = clamp(rawY, 0, 1);
	const width = clamp(rawWidth, MIN_PROJECT_CROP_SIZE, 1 - x);
	const height = clamp(rawHeight, MIN_PROJECT_CROP_SIZE, 1 - y);

	if (width <= 0 || height <= 0) {
		return null;
	}

	return {
		x,
		y,
		width,
		height,
	};
}

function normalizeVideoDimensions(record: Record<string, unknown>): {
	videoWidth: number;
	videoHeight: number;
} | null {
	const videoWidth = optionalFiniteNumber(record, "videoWidth");
	const videoHeight = optionalFiniteNumber(record, "videoHeight");
	if (!videoWidth || !videoHeight || videoWidth <= 0 || videoHeight <= 0) {
		return null;
	}
	return {
		videoWidth: Math.round(videoWidth),
		videoHeight: Math.round(videoHeight),
	};
}

function normalizePixelCrop(record: Record<string, unknown>): CropRegion | null {
	const dimensions = normalizeVideoDimensions(record);
	if (!dimensions) {
		return null;
	}

	const x = optionalFiniteNumber(record, "x") ?? 0;
	const y = optionalFiniteNumber(record, "y") ?? 0;
	const width = optionalFiniteNumber(record, "width") ?? dimensions.videoWidth;
	const height = optionalFiniteNumber(record, "height") ?? dimensions.videoHeight;

	return normalizeCropRegion({
		x: x / dimensions.videoWidth,
		y: y / dimensions.videoHeight,
		width: width / dimensions.videoWidth,
		height: height / dimensions.videoHeight,
	});
}

function normalizePreset(value: unknown): CropAspectPreset | null {
	return CROP_ASPECT_PRESETS.includes(value as CropAspectPreset)
		? (value as CropAspectPreset)
		: null;
}

function applyAspectPresetToCrop(
	cropRegion: CropRegion,
	preset: CropAspectPreset,
	videoWidth: number,
	videoHeight: number,
): CropRegion {
	const [wStr, hStr] = preset.split(":");
	const targetRatio = Number(wStr) / Number(hStr);
	const next = { ...cropRegion };

	const nextHeight = (next.width * videoWidth) / (targetRatio * videoHeight);
	if (next.y + nextHeight <= 1 && nextHeight >= 0.05) {
		next.height = nextHeight;
	} else {
		const nextWidth = (next.height * videoHeight * targetRatio) / videoWidth;
		if (next.x + nextWidth <= 1 && nextWidth >= 0.05) {
			next.width = nextWidth;
		}
	}

	return normalizeCropRegion(next) ?? cropRegion;
}

async function sendCropCommand(
	context: CropToolContext,
	method: string,
	args: unknown,
	timeoutMs = 10_000,
): Promise<unknown> {
	return context.commandBus.send("editor", method, args, {
		ensureWindow: true,
		timeoutMs,
	});
}

export async function getCropTool(args: unknown, context: CropToolContext): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const includePixels = optionalBoolean(record, "includePixels") ?? true;
	const result = await sendCropCommand(context, "crop.get", { includePixels });
	return toolSuccess({ success: true, includePixels, result }, "Crop state loaded.");
}

export async function setNormalizedCropTool(
	args: unknown,
	context: CropToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const cropRegion = normalizeCropRegion(record.cropRegion ?? record);
	if (!cropRegion) {
		return toolFailure(
			"invalid_crop_region",
			"Pass normalized cropRegion { x, y, width, height }.",
		);
	}

	const commit = optionalBoolean(record, "commit") ?? true;
	const result = await sendCropCommand(context, "crop.setNormalized", {
		cropRegion,
		commit,
	});
	return toolSuccess({ success: true, cropRegion, commit, result }, "Crop region set.");
}

export async function setPixelCropTool(
	args: unknown,
	context: CropToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const dimensions = normalizeVideoDimensions(record);
	if (!dimensions) {
		return toolFailure("missing_video_metadata", "Pass positive videoWidth and videoHeight.");
	}

	const cropRegion = normalizePixelCrop(record);
	if (!cropRegion) {
		return toolFailure("invalid_pixel_crop", "Pass pixel crop x, y, width, height.");
	}

	const commit = optionalBoolean(record, "commit") ?? true;
	const result = await sendCropCommand(context, "crop.setPixels", {
		cropRegion,
		...dimensions,
		commit,
	});
	return toolSuccess(
		{ success: true, cropRegion, ...dimensions, commit, result },
		"Pixel crop set.",
	);
}

export async function applyCropAspectPresetTool(
	args: unknown,
	context: CropToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const preset = normalizePreset(record.preset ?? record.aspectRatio);
	if (!preset) {
		return toolFailure("invalid_crop_aspect_preset", "Pass a supported crop aspect preset.", {
			supportedPresets: [...CROP_ASPECT_PRESETS],
		});
	}

	const dimensions = normalizeVideoDimensions(record);
	if (!dimensions) {
		return toolFailure("missing_video_metadata", "Pass positive videoWidth and videoHeight.");
	}

	const currentCropRegion = normalizeCropRegion(record.cropRegion ?? record.currentCropRegion);
	if (!currentCropRegion) {
		return toolFailure("invalid_crop_region", "Pass current cropRegion.");
	}

	const cropRegion = applyAspectPresetToCrop(
		currentCropRegion,
		preset,
		dimensions.videoWidth,
		dimensions.videoHeight,
	);
	const commit = optionalBoolean(record, "commit") ?? true;
	const result = await sendCropCommand(context, "crop.applyAspectPreset", {
		preset,
		cropRegion,
		...dimensions,
		commit,
	});
	return toolSuccess(
		{ success: true, preset, cropRegion, ...dimensions, commit, result },
		"Crop aspect preset applied.",
	);
}

export async function resetCropTool(
	args: unknown,
	context: CropToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const commit = optionalBoolean(record, "commit") ?? true;
	const cropRegion = { ...DEFAULT_CROP_REGION };
	const result = await sendCropCommand(context, "crop.reset", {
		cropRegion,
		commit,
	});
	return toolSuccess({ success: true, cropRegion, commit, result }, "Crop reset.");
}

const cropRegionSchema = {
	type: "object",
	required: ["x", "y", "width", "height"],
	properties: {
		x: { type: "number", minimum: 0, maximum: 1 },
		y: { type: "number", minimum: 0, maximum: 1 },
		width: { type: "number", minimum: 0.01, maximum: 1 },
		height: { type: "number", minimum: 0.01, maximum: 1 },
	},
	additionalProperties: false,
} as const;

const videoDimensionProperties = {
	videoWidth: { type: "number", minimum: 1 },
	videoHeight: { type: "number", minimum: 1 },
} as const;

export const cropToolDefinitions: McpToolDefinition<CropToolContext>[] = [
	{
		name: "openscreen.crop.get",
		description: "Read the current normalized crop region and optional pixel values.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			properties: {
				includePixels: { type: "boolean" },
			},
			additionalProperties: false,
		},
		handler: getCropTool,
	},
	{
		name: "openscreen.crop.setNormalized",
		description: "Set the canonical normalized crop region.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			properties: {
				cropRegion: cropRegionSchema,
				x: { type: "number", minimum: 0, maximum: 1 },
				y: { type: "number", minimum: 0, maximum: 1 },
				width: { type: "number", minimum: 0.01, maximum: 1 },
				height: { type: "number", minimum: 0.01, maximum: 1 },
				commit: { type: "boolean" },
			},
			additionalProperties: false,
		},
		handler: setNormalizedCropTool,
	},
	{
		name: "openscreen.crop.setPixels",
		description: "Set crop using pixel X/Y/W/H and source video dimensions.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			required: ["videoWidth", "videoHeight"],
			properties: {
				...videoDimensionProperties,
				x: { type: "number", minimum: 0 },
				y: { type: "number", minimum: 0 },
				width: { type: "number", minimum: 1 },
				height: { type: "number", minimum: 1 },
				commit: { type: "boolean" },
			},
			additionalProperties: false,
		},
		handler: setPixelCropTool,
	},
	{
		name: "openscreen.crop.applyAspectPreset",
		description: "Apply a stateless crop aspect preset to the current crop box.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			required: ["preset", "cropRegion", "videoWidth", "videoHeight"],
			properties: {
				preset: { enum: CROP_ASPECT_PRESETS },
				aspectRatio: { enum: CROP_ASPECT_PRESETS },
				cropRegion: cropRegionSchema,
				currentCropRegion: cropRegionSchema,
				...videoDimensionProperties,
				commit: { type: "boolean" },
			},
			additionalProperties: false,
		},
		handler: applyCropAspectPresetTool,
	},
	{
		name: "openscreen.crop.reset",
		description: "Reset crop to the full source frame.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			properties: {
				commit: { type: "boolean" },
			},
			additionalProperties: false,
		},
		handler: resetCropTool,
	},
];
