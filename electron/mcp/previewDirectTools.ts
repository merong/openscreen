import type { McpToolDefinition, McpToolResult, RendererCommandBus } from "./toolTypes";
import { toolFailure, toolSuccess } from "./toolTypes";

const FEATURE_DOCUMENT = "docs/user-editable-features/04-preview-direct-editing.md";
const MIN_FREEHAND_POINTS = 3;

export interface PreviewDirectToolContext {
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

function normalizePercentPosition(value: unknown): { x: number; y: number } | null {
	if (!isRecord(value)) {
		return null;
	}
	const x = optionalFiniteNumber(value, "x");
	const y = optionalFiniteNumber(value, "y");
	if (x === undefined || y === undefined) {
		return null;
	}
	return {
		x: clamp(x, 0, 100),
		y: clamp(y, 0, 100),
	};
}

function normalizePercentSize(value: unknown): { width: number; height: number } | null {
	if (!isRecord(value)) {
		return null;
	}
	const width = optionalFiniteNumber(value, "width");
	const height = optionalFiniteNumber(value, "height");
	if (width === undefined || height === undefined) {
		return null;
	}
	return {
		width: clamp(width, 1, 200),
		height: clamp(height, 1, 200),
	};
}

function normalizeFreehandPoints(value: unknown): Array<{ x: number; y: number }> | null {
	if (!Array.isArray(value)) {
		return null;
	}

	const points = value
		.map((point) => normalizePercentPosition(point))
		.filter((point): point is { x: number; y: number } => Boolean(point));

	return points.length >= MIN_FREEHAND_POINTS ? points : null;
}

function getRegionId(record: Record<string, unknown>): string | null {
	return optionalString(record, "id") ?? optionalString(record, "regionId") ?? null;
}

async function sendPreviewCommand(
	context: PreviewDirectToolContext,
	method: string,
	args: unknown,
	timeoutMs = 10_000,
): Promise<unknown> {
	return context.commandBus.send("editor", method, args, {
		ensureWindow: true,
		timeoutMs,
	});
}

export async function getPreviewStateTool(
	_args: unknown,
	context: PreviewDirectToolContext,
): Promise<McpToolResult> {
	const result = await sendPreviewCommand(context, "preview.state.get", {});
	return toolSuccess({ success: true, persisted: false, result }, "Preview state loaded.");
}

export async function setZoomFocusTool(
	args: unknown,
	context: PreviewDirectToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const id = getRegionId(record);
	const focus = normalizeNormPoint(record.focus ?? record);
	const allowAutoFocusOverride = optionalBoolean(record, "allowAutoFocusOverride") ?? false;
	const commit = optionalBoolean(record, "commit") ?? true;

	if (!id) {
		return toolFailure("missing_id", "Pass id or regionId for the zoom region.");
	}
	if (!focus) {
		return toolFailure("invalid_focus", "Pass focus { cx, cy } normalized to 0..1.");
	}

	const result = await sendPreviewCommand(context, "preview.zoom.focus.set", {
		id,
		focus,
		allowAutoFocusOverride,
		commit,
	});
	return toolSuccess(
		{ success: true, id, focus, allowAutoFocusOverride, commit, result },
		"Zoom focus set.",
	);
}

export async function setWebcamPositionTool(
	args: unknown,
	context: PreviewDirectToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const position = normalizeNormPoint(record.position ?? record);
	const requirePictureInPicture = optionalBoolean(record, "requirePictureInPicture") ?? true;
	const commit = optionalBoolean(record, "commit") ?? true;

	if (!position) {
		return toolFailure("invalid_position", "Pass position { cx, cy } normalized to 0..1.");
	}

	const result = await sendPreviewCommand(context, "preview.webcam.position.set", {
		position,
		requirePictureInPicture,
		commit,
	});
	return toolSuccess(
		{ success: true, position, requirePictureInPicture, commit, result },
		"Webcam position set.",
	);
}

export async function setAnnotationPositionTool(
	args: unknown,
	context: PreviewDirectToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const id = getRegionId(record);
	const position = normalizePercentPosition(record.position ?? record);

	if (!id) {
		return toolFailure("missing_id", "Pass id or regionId for the annotation.");
	}
	if (!position) {
		return toolFailure("invalid_position", "Pass position { x, y } in percent coordinates.");
	}

	const result = await sendPreviewCommand(context, "preview.annotation.position.set", {
		id,
		position,
	});
	return toolSuccess({ success: true, id, position, result }, "Annotation position set.");
}

export async function setAnnotationSizeTool(
	args: unknown,
	context: PreviewDirectToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const id = getRegionId(record);
	const size = normalizePercentSize(record.size ?? record);

	if (!id) {
		return toolFailure("missing_id", "Pass id or regionId for the annotation.");
	}
	if (!size) {
		return toolFailure("invalid_size", "Pass size { width, height } in percent coordinates.");
	}

	const result = await sendPreviewCommand(context, "preview.annotation.size.set", {
		id,
		size,
	});
	return toolSuccess({ success: true, id, size, result }, "Annotation size set.");
}

export async function setBlurFreehandTool(
	args: unknown,
	context: PreviewDirectToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const id = getRegionId(record);
	const freehandPoints = normalizeFreehandPoints(record.freehandPoints ?? record.points);
	const commit = optionalBoolean(record, "commit") ?? true;

	if (!id) {
		return toolFailure("missing_id", "Pass id or regionId for the blur annotation.");
	}
	if (!freehandPoints) {
		return toolFailure(
			"invalid_freehand_points",
			"Pass at least 3 freehand points in 0..100 space.",
		);
	}

	const blurData = {
		shape: "freehand",
		freehandPoints,
	};
	const bounds = {
		position: { x: 0, y: 0 },
		size: { width: 100, height: 100 },
	};
	const result = await sendPreviewCommand(context, "preview.blur.freehand.set", {
		id,
		blurData,
		...bounds,
		commit,
	});
	return toolSuccess(
		{ success: true, id, blurData, ...bounds, commit, result },
		"Freehand blur path set.",
	);
}

export async function setPreviewFullscreenTool(
	args: unknown,
	context: PreviewDirectToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const enabled = optionalBoolean(record, "enabled");
	if (enabled === undefined) {
		return toolFailure("invalid_arguments", "Pass enabled: true or false.");
	}

	const result = await sendPreviewCommand(context, "preview.fullscreen.set", {
		enabled,
		persisted: false,
	});
	return toolSuccess(
		{ success: true, enabled, persisted: false, result },
		"Preview fullscreen state set.",
	);
}

const normPointSchema = {
	type: "object",
	required: ["cx", "cy"],
	properties: {
		cx: { type: "number", minimum: 0, maximum: 1 },
		cy: { type: "number", minimum: 0, maximum: 1 },
	},
	additionalProperties: false,
} as const;

const percentPositionSchema = {
	type: "object",
	required: ["x", "y"],
	properties: {
		x: { type: "number", minimum: 0, maximum: 100 },
		y: { type: "number", minimum: 0, maximum: 100 },
	},
	additionalProperties: false,
} as const;

const percentSizeSchema = {
	type: "object",
	required: ["width", "height"],
	properties: {
		width: { type: "number", minimum: 1, maximum: 200 },
		height: { type: "number", minimum: 1, maximum: 200 },
	},
	additionalProperties: false,
} as const;

const idProperties = {
	id: { type: "string" },
	regionId: { type: "string" },
} as const;

export const previewDirectToolDefinitions: McpToolDefinition<PreviewDirectToolContext>[] = [
	{
		name: "openscreen.preview.state",
		description:
			"Read preview UI state such as selected ids, overlay sizes, and fullscreen status.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		handler: getPreviewStateTool,
	},
	{
		name: "openscreen.zoom.focus.set",
		description: "Set a zoom region focus point with normalized 0..1 coordinates.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			required: ["id", "focus"],
			properties: {
				...idProperties,
				focus: normPointSchema,
				allowAutoFocusOverride: { type: "boolean" },
				commit: { type: "boolean" },
			},
			additionalProperties: false,
		},
		handler: setZoomFocusTool,
	},
	{
		name: "openscreen.webcam.position.set",
		description: "Set the PiP webcam center with normalized 0..1 coordinates.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			required: ["position"],
			properties: {
				position: normPointSchema,
				requirePictureInPicture: { type: "boolean" },
				commit: { type: "boolean" },
			},
			additionalProperties: false,
		},
		handler: setWebcamPositionTool,
	},
	{
		name: "openscreen.annotation.position.set",
		description: "Set an annotation overlay position using 0..100 percent coordinates.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			required: ["id", "position"],
			properties: {
				...idProperties,
				position: percentPositionSchema,
			},
			additionalProperties: false,
		},
		handler: setAnnotationPositionTool,
	},
	{
		name: "openscreen.annotation.size.set",
		description: "Set an annotation overlay size using percent coordinates.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			required: ["id", "size"],
			properties: {
				...idProperties,
				size: percentSizeSchema,
			},
			additionalProperties: false,
		},
		handler: setAnnotationSizeTool,
	},
	{
		name: "openscreen.blur.freehand.set",
		description: "Set a freehand blur path and force full-surface bounds for that blur annotation.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			required: ["id", "freehandPoints"],
			properties: {
				...idProperties,
				freehandPoints: { type: "array", items: percentPositionSchema, minItems: 3 },
				commit: { type: "boolean" },
			},
			additionalProperties: false,
		},
		handler: setBlurFreehandTool,
	},
	{
		name: "openscreen.preview.fullscreen.set",
		description: "Set preview fullscreen UI state. This is not saved to the project.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			required: ["enabled"],
			properties: {
				enabled: { type: "boolean" },
			},
			additionalProperties: false,
		},
		handler: setPreviewFullscreenTool,
	},
];
