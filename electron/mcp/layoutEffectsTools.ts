import {
	DEFAULT_WEBCAM_SIZE_PRESET,
	type WebcamMaskShape,
} from "../../src/components/video-editor/types";
import { WEBCAM_LAYOUT_PRESETS, type WebcamLayoutPreset } from "../../src/lib/compositeLayout";
import { classifyWallpaper, WALLPAPER_PATHS } from "../../src/lib/wallpaper";
import {
	ASPECT_RATIOS,
	type AspectRatio,
	isPortraitAspectRatio,
} from "../../src/utils/aspectRatioUtils";
import type { McpToolDefinition, McpToolResult, RendererCommandBus } from "./toolTypes";
import { toolFailure, toolSuccess } from "./toolTypes";

const FEATURE_DOCUMENT = "docs/user-editable-features/05-layout-effects-background.md";
const WEBCAM_LAYOUT_VALUES = WEBCAM_LAYOUT_PRESETS.map((preset) => preset.value);
const WEBCAM_MASK_SHAPES = ["rectangle", "circle", "square", "rounded"] as const;
const JPEG_DATA_URL_RE = /^data:image\/jpe?g;base64,/i;

export interface LayoutEffectsToolContext {
	commandBus: RendererCommandBus;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
	const value = args[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
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

function normalizeAspectRatio(value: unknown): AspectRatio | null {
	return ASPECT_RATIOS.includes(value as AspectRatio) ? (value as AspectRatio) : null;
}

function normalizeWebcamLayout(value: unknown): WebcamLayoutPreset | null {
	return WEBCAM_LAYOUT_VALUES.includes(value as WebcamLayoutPreset)
		? (value as WebcamLayoutPreset)
		: null;
}

function normalizeWebcamMask(value: unknown): WebcamMaskShape | null {
	return WEBCAM_MASK_SHAPES.includes(value as WebcamMaskShape) ? (value as WebcamMaskShape) : null;
}

function normalizeNormPoint(value: unknown): { cx: number; cy: number } | null {
	if (!isRecord(value)) {
		return null;
	}
	const cx = optionalFiniteNumber(value, "cx");
	const cy = optionalFiniteNumber(value, "cy");
	if (cx === undefined || cy === undefined) {
		return null;
	}
	return {
		cx: clamp(cx, 0, 1),
		cy: clamp(cy, 0, 1),
	};
}

function isLayoutCompatibleWithAspect(
	layout: WebcamLayoutPreset,
	aspectRatio: AspectRatio,
): boolean {
	if (layout === "picture-in-picture") {
		return true;
	}
	const portrait = isPortraitAspectRatio(aspectRatio);
	return layout === "vertical-stack" ? portrait : !portrait;
}

function normalizeLayoutForAspect(
	layout: WebcamLayoutPreset | null,
	aspectRatio: AspectRatio,
): WebcamLayoutPreset | null {
	if (!layout) {
		return null;
	}
	return isLayoutCompatibleWithAspect(layout, aspectRatio) ? layout : "picture-in-picture";
}

function normalizeWallpaperValue(value: unknown): { value: string; kind: string } | null {
	if (typeof value !== "string") {
		return null;
	}

	const trimmed = value.trim();
	if (!trimmed || /^file:\/\//i.test(trimmed)) {
		return null;
	}

	const classified = classifyWallpaper(trimmed);
	if (classified.kind === "image" && /^\/wallpapers\/wallpaper\d+\.jpg$/i.test(classified.path)) {
		const canonical = `/wallpapers/${classified.path.split("/").pop()}`;
		return WALLPAPER_PATHS.includes(canonical) ? { value: canonical, kind: "image" } : null;
	}

	if (
		classified.kind === "image" ||
		classified.kind === "color" ||
		classified.kind === "gradient"
	) {
		return { value: trimmed, kind: classified.kind };
	}

	return null;
}

async function sendLayoutCommand(
	context: LayoutEffectsToolContext,
	method: string,
	args: unknown,
	timeoutMs = 10_000,
): Promise<unknown> {
	return context.commandBus.send("editor", method, args, {
		ensureWindow: true,
		timeoutMs,
	});
}

export async function getLayoutOptionsTool(
	_args: unknown,
	context: LayoutEffectsToolContext,
): Promise<McpToolResult> {
	const result = await sendLayoutCommand(context, "layout.options.get", {
		aspectRatios: ASPECT_RATIOS,
		webcamLayouts: WEBCAM_LAYOUT_PRESETS,
		webcamMaskShapes: WEBCAM_MASK_SHAPES,
		webcamSizeRange: { min: 10, max: 50, default: DEFAULT_WEBCAM_SIZE_PRESET },
		wallpapers: WALLPAPER_PATHS,
	});

	return toolSuccess(
		{
			success: true,
			aspectRatios: ASPECT_RATIOS,
			webcamLayouts: WEBCAM_LAYOUT_PRESETS,
			webcamMaskShapes: WEBCAM_MASK_SHAPES,
			webcamSizeRange: { min: 10, max: 50, default: DEFAULT_WEBCAM_SIZE_PRESET },
			wallpapers: WALLPAPER_PATHS,
			result,
		},
		"Layout options loaded.",
	);
}

export async function setAspectRatioTool(
	args: unknown,
	context: LayoutEffectsToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const aspectRatio = normalizeAspectRatio(record.aspectRatio);
	if (!aspectRatio) {
		return toolFailure("invalid_aspect_ratio", "Pass a supported aspectRatio.", {
			supportedAspectRatios: [...ASPECT_RATIOS],
		});
	}

	const requestedLayout = normalizeWebcamLayout(
		record.webcamLayoutPreset ?? record.currentWebcamLayoutPreset,
	);
	const webcamLayoutPreset = normalizeLayoutForAspect(requestedLayout, aspectRatio);
	const patch = {
		aspectRatio,
		...(webcamLayoutPreset ? { webcamLayoutPreset } : {}),
	};
	const result = await sendLayoutCommand(context, "layout.aspectRatio.set", {
		patch,
		compatibilityAdjusted: Boolean(requestedLayout) && requestedLayout !== patch.webcamLayoutPreset,
	});

	return toolSuccess(
		{
			success: true,
			patch,
			compatibilityAdjusted:
				Boolean(requestedLayout) && requestedLayout !== patch.webcamLayoutPreset,
			result,
		},
		"Aspect ratio set.",
	);
}

export async function setWebcamLayoutTool(
	args: unknown,
	context: LayoutEffectsToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const webcamLayoutPreset = normalizeWebcamLayout(record.webcamLayoutPreset ?? record.layout);
	if (!webcamLayoutPreset) {
		return toolFailure("invalid_webcam_layout", "Pass a supported webcam layout.", {
			supportedLayouts: WEBCAM_LAYOUT_VALUES,
		});
	}

	const aspectRatio = normalizeAspectRatio(record.aspectRatio);
	if (aspectRatio && !isLayoutCompatibleWithAspect(webcamLayoutPreset, aspectRatio)) {
		return toolFailure(
			"layout_aspect_mismatch",
			"Webcam layout is not compatible with aspectRatio.",
			{
				aspectRatio,
				webcamLayoutPreset,
			},
		);
	}

	const webcamPosition =
		webcamLayoutPreset === "picture-in-picture"
			? normalizeNormPoint(record.webcamPosition ?? record.position)
			: null;
	const patch = {
		webcamLayoutPreset,
		webcamPosition,
	};
	const result = await sendLayoutCommand(context, "layout.webcamLayout.set", { patch });
	return toolSuccess({ success: true, patch, result }, "Webcam layout set.");
}

export async function setWebcamMaskTool(
	args: unknown,
	context: LayoutEffectsToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const webcamMaskShape = normalizeWebcamMask(record.webcamMaskShape ?? record.maskShape);
	if (!webcamMaskShape) {
		return toolFailure("invalid_webcam_mask", "Pass a supported webcam mask shape.", {
			supportedMaskShapes: [...WEBCAM_MASK_SHAPES],
		});
	}

	const result = await sendLayoutCommand(context, "layout.webcamMask.set", {
		patch: { webcamMaskShape },
		requirePictureInPicture: optionalBoolean(record, "requirePictureInPicture") ?? true,
	});
	return toolSuccess(
		{
			success: true,
			patch: { webcamMaskShape },
			requirePictureInPicture: optionalBoolean(record, "requirePictureInPicture") ?? true,
			result,
		},
		"Webcam mask set.",
	);
}

export async function setWebcamSizeTool(
	args: unknown,
	context: LayoutEffectsToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const rawSize =
		optionalFiniteNumber(record, "webcamSizePreset") ?? optionalFiniteNumber(record, "size");
	if (rawSize === undefined) {
		return toolFailure("invalid_webcam_size", "Pass webcamSizePreset or size.");
	}
	const webcamSizePreset = clamp(rawSize, 10, 50);
	const commit = optionalBoolean(record, "commit") ?? true;

	const result = await sendLayoutCommand(context, "layout.webcamSize.set", {
		patch: { webcamSizePreset },
		commit,
	});
	return toolSuccess(
		{ success: true, patch: { webcamSizePreset }, commit, result },
		"Webcam size set.",
	);
}

export async function setEffectsTool(
	args: unknown,
	context: LayoutEffectsToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const patch = {
		...(optionalBoolean(record, "showBlur") !== undefined
			? { showBlur: optionalBoolean(record, "showBlur") }
			: {}),
		...(optionalFiniteNumber(record, "motionBlurAmount") !== undefined
			? { motionBlurAmount: clamp(optionalFiniteNumber(record, "motionBlurAmount")!, 0, 1) }
			: {}),
		...(optionalFiniteNumber(record, "shadowIntensity") !== undefined
			? { shadowIntensity: clamp(optionalFiniteNumber(record, "shadowIntensity")!, 0, 1) }
			: {}),
		...(optionalFiniteNumber(record, "borderRadius") !== undefined
			? { borderRadius: clamp(optionalFiniteNumber(record, "borderRadius")!, 0, 16) }
			: {}),
		...(optionalFiniteNumber(record, "padding") !== undefined
			? { padding: clamp(optionalFiniteNumber(record, "padding")!, 0, 100) }
			: {}),
	};

	if (Object.keys(patch).length === 0) {
		return toolFailure("empty_effects_patch", "Pass at least one effect field.");
	}

	const commit = optionalBoolean(record, "commit") ?? true;
	const result = await sendLayoutCommand(context, "effects.set", {
		patch,
		commit,
		verticalStackPaddingPolicy: "ignored-by-renderer",
	});
	return toolSuccess(
		{ success: true, patch, commit, verticalStackPaddingPolicy: "ignored-by-renderer", result },
		"Effects set.",
	);
}

export async function setBackgroundTool(
	args: unknown,
	context: LayoutEffectsToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const normalized = normalizeWallpaperValue(record.wallpaper ?? record.value);
	if (!normalized) {
		return toolFailure(
			"invalid_wallpaper",
			"Pass a supported wallpaper color, gradient, canonical image path, URL, or data URL.",
		);
	}

	const result = await sendLayoutCommand(context, "background.set", {
		patch: { wallpaper: normalized.value },
		kind: normalized.kind,
	});
	return toolSuccess(
		{ success: true, patch: { wallpaper: normalized.value }, kind: normalized.kind, result },
		"Background set.",
	);
}

export async function uploadBackgroundImageTool(
	args: unknown,
	context: LayoutEffectsToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const dataUrl = optionalString(record, "dataUrl") ?? optionalString(record, "wallpaper");
	if (!dataUrl || !JPEG_DATA_URL_RE.test(dataUrl)) {
		return toolFailure("invalid_background_upload", "Pass a JPEG/JPG dataUrl.");
	}

	const result = await sendLayoutCommand(context, "background.uploadImage", {
		dataUrl,
		patch: { wallpaper: dataUrl },
		kind: "image",
	});
	return toolSuccess(
		{ success: true, patch: { wallpaper: dataUrl }, kind: "image", result },
		"Background image uploaded.",
	);
}

const aspectRatioSchema = { enum: ASPECT_RATIOS } as const;
const webcamLayoutSchema = { enum: WEBCAM_LAYOUT_VALUES } as const;
const webcamMaskSchema = { enum: WEBCAM_MASK_SHAPES } as const;
const normPointSchema = {
	type: "object",
	required: ["cx", "cy"],
	properties: {
		cx: { type: "number", minimum: 0, maximum: 1 },
		cy: { type: "number", minimum: 0, maximum: 1 },
	},
	additionalProperties: false,
} as const;

export const layoutEffectsToolDefinitions: McpToolDefinition<LayoutEffectsToolContext>[] = [
	{
		name: "openscreen.layout.getOptions",
		description:
			"Read supported aspect ratios, webcam layout presets, mask shapes, and wallpapers.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		handler: getLayoutOptionsTool,
	},
	{
		name: "openscreen.layout.setAspectRatio",
		description:
			"Set the project aspect ratio and adjust incompatible webcam layout when provided.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			required: ["aspectRatio"],
			properties: {
				aspectRatio: aspectRatioSchema,
				webcamLayoutPreset: webcamLayoutSchema,
				currentWebcamLayoutPreset: webcamLayoutSchema,
			},
			additionalProperties: false,
		},
		handler: setAspectRatioTool,
	},
	{
		name: "openscreen.layout.setWebcamLayout",
		description: "Set the webcam layout and clear webcamPosition for non-PiP layouts.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			required: ["webcamLayoutPreset"],
			properties: {
				webcamLayoutPreset: webcamLayoutSchema,
				layout: webcamLayoutSchema,
				aspectRatio: aspectRatioSchema,
				webcamPosition: normPointSchema,
				position: normPointSchema,
			},
			additionalProperties: false,
		},
		handler: setWebcamLayoutTool,
	},
	{
		name: "openscreen.layout.setWebcamMask",
		description: "Set the PiP webcam mask shape.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			required: ["webcamMaskShape"],
			properties: {
				webcamMaskShape: webcamMaskSchema,
				maskShape: webcamMaskSchema,
				requirePictureInPicture: { type: "boolean" },
			},
			additionalProperties: false,
		},
		handler: setWebcamMaskTool,
	},
	{
		name: "openscreen.layout.setWebcamSize",
		description: "Set the PiP webcam size percentage with slider-style commit support.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			properties: {
				webcamSizePreset: { type: "number", minimum: 10, maximum: 50 },
				size: { type: "number", minimum: 10, maximum: 50 },
				commit: { type: "boolean" },
			},
			additionalProperties: false,
		},
		handler: setWebcamSizeTool,
	},
	{
		name: "openscreen.effects.set",
		description: "Set background blur, motion blur, shadow, border radius, and padding effects.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			properties: {
				showBlur: { type: "boolean" },
				motionBlurAmount: { type: "number", minimum: 0, maximum: 1 },
				shadowIntensity: { type: "number", minimum: 0, maximum: 1 },
				borderRadius: { type: "number", minimum: 0, maximum: 16 },
				padding: { type: "number", minimum: 0, maximum: 100 },
				commit: { type: "boolean" },
			},
			additionalProperties: false,
		},
		handler: setEffectsTool,
	},
	{
		name: "openscreen.background.set",
		description: "Set wallpaper to a color, gradient, canonical image path, URL, or data URL.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			properties: {
				wallpaper: { type: "string" },
				value: { type: "string" },
			},
			additionalProperties: false,
		},
		handler: setBackgroundTool,
	},
	{
		name: "openscreen.background.uploadImage",
		description: "Set a user-uploaded JPEG background data URL.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			required: ["dataUrl"],
			properties: {
				dataUrl: { type: "string" },
				wallpaper: { type: "string" },
			},
			additionalProperties: false,
		},
		handler: uploadBackgroundImageTool,
	},
];
