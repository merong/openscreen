import {
	type AnnotationPosition,
	type AnnotationSize,
	type BlurColor,
	type BlurData,
	type BlurShape,
	type BlurType,
	DEFAULT_ANNOTATION_POSITION,
	DEFAULT_ANNOTATION_SIZE,
	DEFAULT_BLUR_BLOCK_SIZE,
	DEFAULT_BLUR_DATA,
	DEFAULT_BLUR_FREEHAND_POINTS,
	DEFAULT_BLUR_INTENSITY,
	MAX_BLUR_BLOCK_SIZE,
	MAX_BLUR_INTENSITY,
	MIN_BLUR_BLOCK_SIZE,
	MIN_BLUR_INTENSITY,
} from "../../src/components/video-editor/types";
import type { McpToolDefinition, McpToolResult, RendererCommandBus } from "./toolTypes";
import { toolFailure, toolSuccess } from "./toolTypes";

const FEATURE_DOCUMENT = "docs/user-editable-features/09-blur-and-mosaic.md";
const BLUR_SHAPES = ["rectangle", "oval", "freehand"] as const;
const UI_BLUR_SHAPES = ["rectangle", "oval"] as const;
const BLUR_TYPES = ["blur", "mosaic"] as const;
const BLUR_COLORS = ["white", "black"] as const;
const MIN_FREEHAND_POINTS = 3;

interface Span {
	startMs: number;
	endMs: number;
}

export interface BlurToolContext {
	commandBus: RendererCommandBus;
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

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function getRegionId(record: Record<string, unknown>): string | null {
	return optionalString(record, "id") ?? optionalString(record, "regionId") ?? null;
}

function normalizeBlurShape(value: unknown): BlurShape | null {
	return BLUR_SHAPES.includes(value as BlurShape) ? (value as BlurShape) : null;
}

function normalizeBlurType(value: unknown): BlurType | null {
	return BLUR_TYPES.includes(value as BlurType) ? (value as BlurType) : null;
}

function normalizeBlurColor(value: unknown): BlurColor | null {
	return BLUR_COLORS.includes(value as BlurColor) ? (value as BlurColor) : null;
}

function normalizePercentPosition(value: unknown): AnnotationPosition | null {
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

function normalizePercentSize(value: unknown): AnnotationSize | null {
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

function hasSpanInput(record: Record<string, unknown>): boolean {
	if (isRecord(record.span)) {
		return (
			"startMs" in record.span ||
			"endMs" in record.span ||
			"start" in record.span ||
			"end" in record.span
		);
	}
	return "startMs" in record || "endMs" in record || "start" in record || "end" in record;
}

function normalizeSpan(record: Record<string, unknown>): Span | null | undefined {
	if (!hasSpanInput(record)) {
		return undefined;
	}

	const span = isRecord(record.span) ? record.span : record;
	const start = optionalFiniteNumber(span, "startMs") ?? optionalFiniteNumber(span, "start");
	const end = optionalFiniteNumber(span, "endMs") ?? optionalFiniteNumber(span, "end");
	if (start === undefined || end === undefined) {
		return null;
	}

	const startMs = Math.max(0, Math.round(start));
	const endMs = Math.max(startMs + 1, Math.round(end));
	return { startMs, endMs };
}

function getBlurDataInput(record: Record<string, unknown>): Record<string, unknown> {
	return isRecord(record.blurData) ? record.blurData : isRecord(record.data) ? record.data : record;
}

function normalizeBlurData(
	value: unknown,
): { blurData: BlurData; freehandBoundsRequired: boolean } | { error: McpToolResult } {
	const record = isRecord(value) ? value : {};
	const shape =
		record.shape === undefined ? DEFAULT_BLUR_DATA.shape : normalizeBlurShape(record.shape);
	if (!shape) {
		return {
			error: toolFailure("invalid_blur_shape", "Pass shape as rectangle, oval, or freehand.", {
				shapes: [...BLUR_SHAPES],
				uiShapes: [...UI_BLUR_SHAPES],
			}),
		};
	}

	const type = record.type === undefined ? DEFAULT_BLUR_DATA.type : normalizeBlurType(record.type);
	if (!type) {
		return {
			error: toolFailure("invalid_blur_type", "Pass type as blur or mosaic.", {
				types: [...BLUR_TYPES],
			}),
		};
	}

	const color =
		record.color === undefined ? DEFAULT_BLUR_DATA.color : normalizeBlurColor(record.color);
	if (!color) {
		return {
			error: toolFailure("invalid_blur_color", "Pass color as white or black.", {
				colors: [...BLUR_COLORS],
			}),
		};
	}

	const intensity = optionalFiniteNumber(record, "intensity");
	const blockSize = optionalFiniteNumber(record, "blockSize");
	const hasFreehandPoints = "freehandPoints" in record || "points" in record;
	const freehandPointsValue = record.freehandPoints ?? record.points;
	const freehandPoints = hasFreehandPoints
		? normalizeFreehandPoints(freehandPointsValue)
		: undefined;
	if (hasFreehandPoints && !freehandPoints) {
		return {
			error: toolFailure(
				"invalid_freehand_points",
				"Pass at least 3 freehand points in 0..100 space.",
			),
		};
	}

	if (hasFreehandPoints && shape !== "freehand") {
		return {
			error: toolFailure(
				"freehand_shape_required",
				"freehandPoints can only be used with shape: freehand.",
			),
		};
	}

	return {
		blurData: {
			type,
			shape,
			color,
			intensity:
				intensity === undefined
					? DEFAULT_BLUR_INTENSITY
					: Math.round(clamp(intensity, MIN_BLUR_INTENSITY, MAX_BLUR_INTENSITY)),
			blockSize:
				blockSize === undefined
					? DEFAULT_BLUR_BLOCK_SIZE
					: Math.round(clamp(blockSize, MIN_BLUR_BLOCK_SIZE, MAX_BLUR_BLOCK_SIZE)),
			...(shape === "freehand"
				? { freehandPoints: freehandPoints ?? DEFAULT_BLUR_FREEHAND_POINTS }
				: {}),
		},
		freehandBoundsRequired: shape === "freehand",
	};
}

function getActiveControl(blurData: BlurData): {
	valueKind: "intensity" | "blockSize";
	value: number;
	range: { min: number; max: number };
} {
	return blurData.type === "mosaic"
		? {
				valueKind: "blockSize",
				value: blurData.blockSize,
				range: { min: MIN_BLUR_BLOCK_SIZE, max: MAX_BLUR_BLOCK_SIZE },
			}
		: {
				valueKind: "intensity",
				value: blurData.intensity,
				range: { min: MIN_BLUR_INTENSITY, max: MAX_BLUR_INTENSITY },
			};
}

function normalizeBounds(
	record: Record<string, unknown>,
	defaults: { useDefaults: boolean },
): {
	position?: AnnotationPosition;
	size?: AnnotationSize;
	hasInput: boolean;
} {
	const position = normalizePercentPosition(record.position ?? record);
	const size = normalizePercentSize(record.size ?? record);
	return {
		position: position ?? (defaults.useDefaults ? { ...DEFAULT_ANNOTATION_POSITION } : undefined),
		size: size ?? (defaults.useDefaults ? { ...DEFAULT_ANNOTATION_SIZE } : undefined),
		hasInput: Boolean(position || size),
	};
}

function forceFreehandBounds(): { position: AnnotationPosition; size: AnnotationSize } {
	return {
		position: { x: 0, y: 0 },
		size: { width: 100, height: 100 },
	};
}

function normalizeBoundsShape(record: Record<string, unknown>): BlurShape | null | undefined {
	if (record.shape === undefined && record.currentShape === undefined) {
		return undefined;
	}
	return normalizeBlurShape(record.shape ?? record.currentShape);
}

async function sendBlurCommand(
	context: BlurToolContext,
	method: string,
	args: unknown,
	timeoutMs = 10_000,
): Promise<unknown> {
	return context.commandBus.send("editor", method, args, {
		ensureWindow: true,
		timeoutMs,
	});
}

export async function listBlursTool(
	_args: unknown,
	context: BlurToolContext,
): Promise<McpToolResult> {
	const result = await sendBlurCommand(context, "blurs.list", {});
	return toolSuccess({ success: true, result }, "Blur regions loaded.");
}

export async function addBlurTool(args: unknown, context: BlurToolContext): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const span = normalizeSpan(record);
	if (span === null) {
		return toolFailure("invalid_span", "Pass both startMs and endMs for a blur span.");
	}

	const normalized = normalizeBlurData(getBlurDataInput(record));
	if ("error" in normalized) {
		return normalized.error;
	}

	const bounds = normalized.freehandBoundsRequired
		? forceFreehandBounds()
		: normalizeBounds(record, { useDefaults: true });
	const commit = optionalBoolean(record, "commit") ?? true;
	const result = await sendBlurCommand(context, "blurs.add", {
		...(span ? { span } : { useCurrentTime: true }),
		blurData: normalized.blurData,
		position: bounds.position,
		size: bounds.size,
		commit,
	});

	return toolSuccess(
		{
			success: true,
			span,
			useCurrentTime: !span,
			blurData: normalized.blurData,
			activeControl: getActiveControl(normalized.blurData),
			position: bounds.position,
			size: bounds.size,
			boundsForcedForFreehand: normalized.freehandBoundsRequired,
			commit,
			result,
		},
		"Blur add requested.",
	);
}

export async function setBlurDataTool(
	args: unknown,
	context: BlurToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const id = getRegionId(record);
	if (!id) {
		return toolFailure("missing_id", "Pass id or regionId for the blur annotation.");
	}

	const normalized = normalizeBlurData(getBlurDataInput(record));
	if ("error" in normalized) {
		return normalized.error;
	}

	const commit = optionalBoolean(record, "commit") ?? true;
	const bounds = normalized.freehandBoundsRequired ? forceFreehandBounds() : {};
	const result = await sendBlurCommand(context, "blurs.data.set", {
		id,
		blurData: normalized.blurData,
		...bounds,
		commit,
	});

	return toolSuccess(
		{
			success: true,
			id,
			blurData: normalized.blurData,
			activeControl: getActiveControl(normalized.blurData),
			...bounds,
			boundsForcedForFreehand: normalized.freehandBoundsRequired,
			commit,
			result,
		},
		"Blur data set.",
	);
}

export async function previewBlurDataTool(
	args: unknown,
	context: BlurToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const id = getRegionId(record);
	if (!id) {
		return toolFailure("missing_id", "Pass id or regionId for the blur annotation.");
	}

	const normalized = normalizeBlurData(getBlurDataInput(record));
	if ("error" in normalized) {
		return normalized.error;
	}

	const commit = optionalBoolean(record, "commit") ?? false;
	const bounds = normalized.freehandBoundsRequired ? forceFreehandBounds() : {};
	const result = await sendBlurCommand(context, "blurs.data.preview", {
		id,
		blurData: normalized.blurData,
		...bounds,
		commit,
	});

	return toolSuccess(
		{
			success: true,
			id,
			blurData: normalized.blurData,
			activeControl: getActiveControl(normalized.blurData),
			...bounds,
			boundsForcedForFreehand: normalized.freehandBoundsRequired,
			commit,
			result,
		},
		"Blur data previewed.",
	);
}

export async function setBlurBoundsTool(
	args: unknown,
	context: BlurToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const id = getRegionId(record);
	if (!id) {
		return toolFailure("missing_id", "Pass id or regionId for the blur annotation.");
	}

	const shape = normalizeBoundsShape(record);
	if (shape === null) {
		return toolFailure(
			"invalid_blur_shape",
			"Pass shape/currentShape as rectangle, oval, or freehand.",
			{
				shapes: [...BLUR_SHAPES],
			},
		);
	}

	const freehand = shape === "freehand" || optionalBoolean(record, "freehand") === true;
	const normalizedBounds = normalizeBounds(record, { useDefaults: false });
	if (!freehand && !normalizedBounds.hasInput) {
		return toolFailure("invalid_bounds", "Pass position and/or size in percent coordinates.");
	}

	const bounds = freehand
		? forceFreehandBounds()
		: {
				...(normalizedBounds.position ? { position: normalizedBounds.position } : {}),
				...(normalizedBounds.size ? { size: normalizedBounds.size } : {}),
			};
	const commit = optionalBoolean(record, "commit") ?? true;
	const result = await sendBlurCommand(context, "blurs.bounds.set", {
		id,
		...bounds,
		commit,
	});

	return toolSuccess(
		{
			success: true,
			id,
			...bounds,
			boundsForcedForFreehand: freehand,
			commit,
			result,
		},
		"Blur bounds set.",
	);
}

export async function deleteBlurTool(
	args: unknown,
	context: BlurToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const id = getRegionId(record);
	if (!id) {
		return toolFailure("missing_id", "Pass id or regionId for the blur annotation.");
	}

	const result = await sendBlurCommand(context, "blurs.delete", { id });
	return toolSuccess({ success: true, id, result }, "Blur deleted.");
}

const idProperties = {
	id: { type: "string" },
	regionId: { type: "string" },
} as const;

const blurDataProperties = {
	type: { enum: BLUR_TYPES },
	shape: { enum: BLUR_SHAPES },
	color: { enum: BLUR_COLORS },
	intensity: { type: "number", minimum: MIN_BLUR_INTENSITY, maximum: MAX_BLUR_INTENSITY },
	blockSize: { type: "number", minimum: MIN_BLUR_BLOCK_SIZE, maximum: MAX_BLUR_BLOCK_SIZE },
	freehandPoints: {
		type: "array",
		items: {
			type: "object",
			required: ["x", "y"],
			properties: {
				x: { type: "number", minimum: 0, maximum: 100 },
				y: { type: "number", minimum: 0, maximum: 100 },
			},
			additionalProperties: false,
		},
		minItems: MIN_FREEHAND_POINTS,
	},
	points: {
		type: "array",
		items: {
			type: "object",
			required: ["x", "y"],
			properties: {
				x: { type: "number", minimum: 0, maximum: 100 },
				y: { type: "number", minimum: 0, maximum: 100 },
			},
			additionalProperties: false,
		},
		minItems: MIN_FREEHAND_POINTS,
	},
} as const;

const blurDataSchema = {
	type: "object",
	properties: blurDataProperties,
	additionalProperties: false,
} as const;

const positionSchema = {
	type: "object",
	required: ["x", "y"],
	properties: {
		x: { type: "number", minimum: 0, maximum: 100 },
		y: { type: "number", minimum: 0, maximum: 100 },
	},
	additionalProperties: false,
} as const;

const sizeSchema = {
	type: "object",
	required: ["width", "height"],
	properties: {
		width: { type: "number", minimum: 1, maximum: 200 },
		height: { type: "number", minimum: 1, maximum: 200 },
	},
	additionalProperties: false,
} as const;

const spanSchema = {
	type: "object",
	properties: {
		startMs: { type: "number", minimum: 0 },
		endMs: { type: "number", minimum: 1 },
		start: { type: "number", minimum: 0 },
		end: { type: "number", minimum: 1 },
	},
	additionalProperties: false,
} as const;

export const blurToolDefinitions: McpToolDefinition<BlurToolContext>[] = [
	{
		name: "openscreen.blurs.list",
		description: "List blur annotation regions only.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
		handler: listBlursTool,
	},
	{
		name: "openscreen.blurs.add",
		description: "Add a blur/mosaic annotation using the editor blur creation flow.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			properties: {
				startMs: { type: "number", minimum: 0 },
				endMs: { type: "number", minimum: 1 },
				start: { type: "number", minimum: 0 },
				end: { type: "number", minimum: 1 },
				span: spanSchema,
				blurData: blurDataSchema,
				data: blurDataSchema,
				...blurDataProperties,
				position: positionSchema,
				size: sizeSchema,
				commit: { type: "boolean" },
			},
			additionalProperties: false,
		},
		handler: addBlurTool,
	},
	{
		name: "openscreen.blurs.setData",
		description: "Set blur panel data and commit it to editor history.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			properties: {
				...idProperties,
				blurData: blurDataSchema,
				data: blurDataSchema,
				...blurDataProperties,
				commit: { type: "boolean" },
			},
			additionalProperties: false,
		},
		handler: setBlurDataTool,
	},
	{
		name: "openscreen.blurs.previewData",
		description: "Preview blur data without committing by default; useful for sliders/freehand.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			properties: {
				...idProperties,
				blurData: blurDataSchema,
				data: blurDataSchema,
				...blurDataProperties,
				commit: { type: "boolean" },
			},
			additionalProperties: false,
		},
		handler: previewBlurDataTool,
	},
	{
		name: "openscreen.blurs.setBounds",
		description: "Set blur annotation position/size in percent coordinates.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			properties: {
				...idProperties,
				position: positionSchema,
				size: sizeSchema,
				x: { type: "number", minimum: 0, maximum: 100 },
				y: { type: "number", minimum: 0, maximum: 100 },
				width: { type: "number", minimum: 1, maximum: 200 },
				height: { type: "number", minimum: 1, maximum: 200 },
				shape: { enum: BLUR_SHAPES },
				currentShape: { enum: BLUR_SHAPES },
				freehand: { type: "boolean" },
				commit: { type: "boolean" },
			},
			additionalProperties: false,
		},
		handler: setBlurBoundsTool,
	},
	{
		name: "openscreen.blurs.delete",
		description: "Delete a blur annotation and clear editor selection when needed.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			properties: idProperties,
			additionalProperties: false,
		},
		handler: deleteBlurTool,
	},
];
