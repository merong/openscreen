import {
	type AnnotationPosition,
	type AnnotationSize,
	type AnnotationTextStyle,
	type ArrowDirection,
	DEFAULT_ANNOTATION_POSITION,
	DEFAULT_ANNOTATION_SIZE,
	DEFAULT_FIGURE_DATA,
	type FigureData,
} from "../../src/components/video-editor/types";
import type { McpToolDefinition, McpToolResult, RendererCommandBus } from "./toolTypes";
import { toolFailure, toolSuccess } from "./toolTypes";

const FEATURE_DOCUMENT = "docs/user-editable-features/08-annotation-editing.md";

const ANNOTATION_TYPES = ["text", "image", "figure"] as const;
const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 96, 128] as const;
const FONT_WEIGHTS = ["normal", "bold"] as const;
const FONT_STYLES = ["normal", "italic"] as const;
const TEXT_DECORATIONS = ["none", "underline"] as const;
const TEXT_ALIGNS = ["left", "center", "right"] as const;
const ARROW_DIRECTIONS = [
	"up",
	"down",
	"left",
	"right",
	"up-right",
	"up-left",
	"down-right",
	"down-left",
] as const;
const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const SUPPORTED_IMAGE_DATA_URL_RE = /^data:image\/(?:jpeg|jpg|png|gif|webp);base64,/i;

type SupportedAnnotationType = (typeof ANNOTATION_TYPES)[number];

interface Span {
	startMs: number;
	endMs: number;
}

interface CustomFont {
	id: string;
	name: string;
	fontFamily: string;
	importUrl: string;
}

export interface AnnotationToolContext {
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

function normalizeAnnotationType(value: unknown): SupportedAnnotationType | null {
	return ANNOTATION_TYPES.includes(value as SupportedAnnotationType)
		? (value as SupportedAnnotationType)
		: null;
}

function normalizeId(record: Record<string, unknown>): string | null {
	return optionalString(record, "id") ?? optionalString(record, "annotationId") ?? null;
}

function normalizeSpan(record: Record<string, unknown>): Span | null {
	const span = isRecord(record.span) ? record.span : record;
	const start = optionalFiniteNumber(span, "startMs") ?? optionalFiniteNumber(span, "start");
	const end = optionalFiniteNumber(span, "endMs") ?? optionalFiniteNumber(span, "end");

	if (start === undefined && end === undefined) {
		return null;
	}

	if (start === undefined || end === undefined) {
		return null;
	}

	const startMs = Math.max(0, Math.round(start));
	const endMs = Math.max(startMs + 1, Math.round(end));
	return { startMs, endMs };
}

function normalizePercentPoint(value: unknown): AnnotationPosition | null {
	if (!isRecord(value)) {
		return null;
	}
	const x = optionalFiniteNumber(value, "x");
	const y = optionalFiniteNumber(value, "y");
	if (x === undefined || y === undefined) {
		return null;
	}
	return { x: clamp(x, 0, 100), y: clamp(y, 0, 100) };
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
	return { width: clamp(width, 1, 200), height: clamp(height, 1, 200) };
}

function normalizeColor(value: unknown, allowTransparent = false): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	if (allowTransparent && trimmed === "transparent") {
		return "transparent";
	}
	return HEX_COLOR_RE.test(trimmed) ? trimmed : null;
}

function normalizeFontSize(value: unknown): AnnotationTextStyle["fontSize"] | null {
	const fontSize = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
	return FONT_SIZES.includes(fontSize as (typeof FONT_SIZES)[number]) ? fontSize : null;
}

function normalizeTextStyle(value: unknown): Partial<AnnotationTextStyle> | null {
	if (!isRecord(value)) {
		return null;
	}

	const style: Partial<AnnotationTextStyle> = {};

	if ("color" in value) {
		const color = normalizeColor(value.color);
		if (!color) {
			return null;
		}
		style.color = color;
	}

	if ("backgroundColor" in value) {
		const backgroundColor = normalizeColor(value.backgroundColor, true);
		if (!backgroundColor) {
			return null;
		}
		style.backgroundColor = backgroundColor;
	}

	if ("fontSize" in value) {
		const fontSize = normalizeFontSize(value.fontSize);
		if (!fontSize) {
			return null;
		}
		style.fontSize = fontSize;
	}

	if ("fontFamily" in value) {
		const fontFamily = optionalString(value, "fontFamily");
		if (!fontFamily) {
			return null;
		}
		style.fontFamily = fontFamily;
	}

	if ("fontWeight" in value) {
		if (!FONT_WEIGHTS.includes(value.fontWeight as AnnotationTextStyle["fontWeight"])) {
			return null;
		}
		style.fontWeight = value.fontWeight as AnnotationTextStyle["fontWeight"];
	}

	if ("fontStyle" in value) {
		if (!FONT_STYLES.includes(value.fontStyle as AnnotationTextStyle["fontStyle"])) {
			return null;
		}
		style.fontStyle = value.fontStyle as AnnotationTextStyle["fontStyle"];
	}

	if ("textDecoration" in value) {
		if (!TEXT_DECORATIONS.includes(value.textDecoration as AnnotationTextStyle["textDecoration"])) {
			return null;
		}
		style.textDecoration = value.textDecoration as AnnotationTextStyle["textDecoration"];
	}

	if ("textAlign" in value) {
		if (!TEXT_ALIGNS.includes(value.textAlign as AnnotationTextStyle["textAlign"])) {
			return null;
		}
		style.textAlign = value.textAlign as AnnotationTextStyle["textAlign"];
	}

	return Object.keys(style).length > 0 ? style : null;
}

function normalizeArrowDirection(value: unknown): ArrowDirection | null {
	return ARROW_DIRECTIONS.includes(value as ArrowDirection) ? (value as ArrowDirection) : null;
}

function normalizeFigureData(value: unknown): FigureData | null {
	const record = isRecord(value) ? value : {};
	const arrowDirection =
		record.arrowDirection === undefined
			? DEFAULT_FIGURE_DATA.arrowDirection
			: normalizeArrowDirection(record.arrowDirection);
	const color =
		record.color === undefined ? DEFAULT_FIGURE_DATA.color : normalizeColor(record.color);
	const strokeWidth = optionalFiniteNumber(record, "strokeWidth");

	if (!arrowDirection || !color) {
		return null;
	}

	return {
		arrowDirection,
		color,
		strokeWidth:
			strokeWidth === undefined
				? DEFAULT_FIGURE_DATA.strokeWidth
				: Math.round(clamp(strokeWidth, 1, 6)),
	};
}

function isSupportedImageDataUrl(value: string): boolean {
	return SUPPORTED_IMAGE_DATA_URL_RE.test(value);
}

function normalizeContentForType(content: unknown, type?: SupportedAnnotationType): string | null {
	if (typeof content !== "string") {
		return null;
	}

	if (type === "image" || content.startsWith("data:image")) {
		return isSupportedImageDataUrl(content) ? content : null;
	}

	return content;
}

function normalizeGoogleFontImportUrl(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	try {
		const url = new URL(trimmed);
		if (url.hostname !== "fonts.googleapis.com" || !url.searchParams.has("family")) {
			return null;
		}
		return url.toString();
	} catch {
		return null;
	}
}

function parseFontFamilyFromImportUrl(importUrl: string): string | null {
	try {
		const url = new URL(importUrl);
		const family = url.searchParams.get("family");
		if (!family) {
			return null;
		}
		return family.split(":")[0]?.replace(/\+/g, " ") ?? null;
	} catch {
		return null;
	}
}

function generateFontId(name: string): string {
	const slug = name
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return `${slug || "font"}-${Date.now()}`;
}

async function sendAnnotationCommand(
	context: AnnotationToolContext,
	method: string,
	args: unknown,
	timeoutMs = 10_000,
): Promise<unknown> {
	return context.commandBus.send("editor", method, args, {
		ensureWindow: true,
		timeoutMs,
	});
}

export async function listAnnotationsTool(
	args: unknown,
	context: AnnotationToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const includeBlur = optionalBoolean(record, "includeBlur") ?? false;
	const result = await sendAnnotationCommand(context, "annotations.list", { includeBlur });
	return toolSuccess({ success: true, includeBlur, result }, "Annotations loaded.");
}

export async function addAnnotationTool(
	args: unknown,
	context: AnnotationToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const type = record.type === undefined ? "text" : normalizeAnnotationType(record.type);
	if (!type) {
		return toolFailure("invalid_annotation_type", "Pass type as text, image, or figure.", {
			supportedTypes: [...ANNOTATION_TYPES],
		});
	}

	const span = normalizeSpan(record);
	const commit = optionalBoolean(record, "commit") ?? true;
	const contentValue = record.content ?? record.text ?? record.imageDataUrl;
	const content =
		contentValue === undefined ? undefined : normalizeContentForType(contentValue, type);
	if (contentValue !== undefined && content === null) {
		return toolFailure(
			"invalid_annotation_content",
			"Image annotations require a JPEG, PNG, GIF, or WEBP data URL.",
		);
	}

	const styleInput = isRecord(record.style) ? record.style : null;
	const style = styleInput ? normalizeTextStyle(styleInput) : undefined;
	if (styleInput && !style) {
		return toolFailure("invalid_annotation_style", "Pass a valid partial text style.");
	}

	const figureInput = isRecord(record.figureData) ? record.figureData : null;
	const figureData =
		type === "figure" ? normalizeFigureData(figureInput ?? record.figure ?? {}) : undefined;
	if (type === "figure" && !figureData) {
		return toolFailure(
			"invalid_figure_data",
			"Pass valid arrow direction, color, and strokeWidth.",
		);
	}

	const position = normalizePercentPoint(record.position) ?? { ...DEFAULT_ANNOTATION_POSITION };
	const size = normalizePercentSize(record.size) ?? { ...DEFAULT_ANNOTATION_SIZE };
	const annotation = {
		type,
		...(content !== undefined ? { content } : {}),
		...(style ? { style } : {}),
		...(figureData ? { figureData } : {}),
		position,
		size,
	};
	const result = await sendAnnotationCommand(context, "annotations.add", {
		...(span ? { span } : { useCurrentTime: true }),
		annotation,
		commit,
	});

	return toolSuccess(
		{
			success: true,
			span,
			useCurrentTime: !span,
			annotation,
			commit,
			result,
		},
		"Annotation add requested.",
	);
}

export async function setAnnotationTypeTool(
	args: unknown,
	context: AnnotationToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const id = normalizeId(record);
	const type = normalizeAnnotationType(record.type);
	if (!id) {
		return toolFailure("missing_id", "Pass id or annotationId.");
	}
	if (!type) {
		return toolFailure("invalid_annotation_type", "Pass type as text, image, or figure.", {
			supportedTypes: [...ANNOTATION_TYPES],
		});
	}

	const commit = optionalBoolean(record, "commit") ?? true;
	const result = await sendAnnotationCommand(context, "annotations.type.set", {
		id,
		type,
		preserveContent: true,
		commit,
	});
	return toolSuccess({ success: true, id, type, commit, result }, "Annotation type set.");
}

export async function setAnnotationContentTool(
	args: unknown,
	context: AnnotationToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const id = normalizeId(record);
	const type = normalizeAnnotationType(record.type);
	if (record.type !== undefined && !type) {
		return toolFailure("invalid_annotation_type", "Pass type as text, image, or figure.", {
			supportedTypes: [...ANNOTATION_TYPES],
		});
	}

	const content = normalizeContentForType(record.content, type ?? undefined);
	if (!id) {
		return toolFailure("missing_id", "Pass id or annotationId.");
	}
	if (content === null) {
		return toolFailure(
			"invalid_annotation_content",
			"Pass content as text or a supported image data URL.",
		);
	}

	const commit = optionalBoolean(record, "commit") ?? true;
	const result = await sendAnnotationCommand(context, "annotations.content.set", {
		id,
		content,
		...(type ? { type } : {}),
		commit,
	});
	return toolSuccess(
		{ success: true, id, content, type, commit, result },
		"Annotation content set.",
	);
}

export async function setAnnotationStyleTool(
	args: unknown,
	context: AnnotationToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const id = normalizeId(record);
	const styleInput = isRecord(record.style) ? record.style : record;
	const style = normalizeTextStyle(styleInput);
	if (!id) {
		return toolFailure("missing_id", "Pass id or annotationId.");
	}
	if (!style) {
		return toolFailure("invalid_annotation_style", "Pass a valid partial text style.", {
			fontSizes: [...FONT_SIZES],
			fontWeights: [...FONT_WEIGHTS],
			fontStyles: [...FONT_STYLES],
			textDecorations: [...TEXT_DECORATIONS],
			textAligns: [...TEXT_ALIGNS],
		});
	}

	const commit = optionalBoolean(record, "commit") ?? true;
	const result = await sendAnnotationCommand(context, "annotations.style.set", {
		id,
		style,
		commit,
	});
	return toolSuccess({ success: true, id, style, commit, result }, "Annotation style set.");
}

export async function setAnnotationFigureTool(
	args: unknown,
	context: AnnotationToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const id = normalizeId(record);
	const figureInput = isRecord(record.figureData) ? record.figureData : record;
	const figureData = normalizeFigureData(figureInput);
	if (!id) {
		return toolFailure("missing_id", "Pass id or annotationId.");
	}
	if (!figureData) {
		return toolFailure(
			"invalid_figure_data",
			"Pass valid arrow direction, color, and strokeWidth.",
			{
				arrowDirections: [...ARROW_DIRECTIONS],
			},
		);
	}

	const commit = optionalBoolean(record, "commit") ?? true;
	const result = await sendAnnotationCommand(context, "annotations.figure.set", {
		id,
		figureData,
		commit,
	});
	return toolSuccess({ success: true, id, figureData, commit, result }, "Annotation figure set.");
}

export async function duplicateAnnotationTool(
	args: unknown,
	context: AnnotationToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const id = normalizeId(record);
	if (!id) {
		return toolFailure("missing_id", "Pass id or annotationId.");
	}

	const result = await sendAnnotationCommand(context, "annotations.duplicate", {
		id,
		offsetPercent: 4,
	});
	return toolSuccess({ success: true, id, offsetPercent: 4, result }, "Annotation duplicated.");
}

export async function deleteAnnotationTool(
	args: unknown,
	context: AnnotationToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const id = normalizeId(record);
	if (!id) {
		return toolFailure("missing_id", "Pass id or annotationId.");
	}

	const result = await sendAnnotationCommand(context, "annotations.delete", { id });
	return toolSuccess({ success: true, id, result }, "Annotation deleted.");
}

export async function listCustomFontsTool(
	_args: unknown,
	context: AnnotationToolContext,
): Promise<McpToolResult> {
	const result = await sendAnnotationCommand(context, "customFonts.list", {});
	return toolSuccess({ success: true, result }, "Custom fonts loaded.");
}

export async function addCustomFontTool(
	args: unknown,
	context: AnnotationToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const importUrl = normalizeGoogleFontImportUrl(record.importUrl ?? record.url);
	if (!importUrl) {
		return toolFailure("invalid_google_font_url", "Pass a fonts.googleapis.com importUrl.");
	}

	const parsedFontFamily = parseFontFamilyFromImportUrl(importUrl);
	if (!parsedFontFamily) {
		return toolFailure("font_family_parse_failed", "Could not extract font family from importUrl.");
	}

	const name = optionalString(record, "name") ?? parsedFontFamily;
	const font: CustomFont = {
		id: optionalString(record, "id") ?? generateFontId(name),
		name,
		fontFamily: optionalString(record, "fontFamily") ?? parsedFontFamily,
		importUrl,
	};

	const result = await sendAnnotationCommand(context, "customFonts.add", { font }, 15_000);
	return toolSuccess({ success: true, font, result }, "Custom font add requested.");
}

export async function removeCustomFontTool(
	args: unknown,
	context: AnnotationToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const id = optionalString(record, "id") ?? optionalString(record, "fontId");
	if (!id) {
		return toolFailure("missing_font_id", "Pass id or fontId.");
	}

	const result = await sendAnnotationCommand(context, "customFonts.remove", { id });
	return toolSuccess({ success: true, id, result }, "Custom font removed.");
}

const idProperties = {
	id: { type: "string" },
	annotationId: { type: "string" },
} as const;

const textStyleProperties = {
	color: { type: "string", pattern: "^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$" },
	backgroundColor: {
		oneOf: [
			{ type: "string", pattern: "^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$" },
			{ const: "transparent" },
		],
	},
	fontSize: { enum: FONT_SIZES },
	fontFamily: { type: "string" },
	fontWeight: { enum: FONT_WEIGHTS },
	fontStyle: { enum: FONT_STYLES },
	textDecoration: { enum: TEXT_DECORATIONS },
	textAlign: { enum: TEXT_ALIGNS },
} as const;

const textStyleSchema = {
	type: "object",
	properties: textStyleProperties,
	additionalProperties: false,
} as const;

const figureDataProperties = {
	arrowDirection: { enum: ARROW_DIRECTIONS },
	color: { type: "string", pattern: "^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$" },
	strokeWidth: { type: "number", minimum: 1, maximum: 6 },
} as const;

const figureDataSchema = {
	type: "object",
	properties: figureDataProperties,
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

export const annotationToolDefinitions: McpToolDefinition<AnnotationToolContext>[] = [
	{
		name: "openscreen.annotations.list",
		description: "List annotation regions, excluding blur regions by default.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			properties: {
				includeBlur: { type: "boolean" },
			},
			additionalProperties: false,
		},
		handler: listAnnotationsTool,
	},
	{
		name: "openscreen.annotations.add",
		description: "Add a text/image/figure annotation using the editor annotation creation flow.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			properties: {
				startMs: { type: "number", minimum: 0 },
				endMs: { type: "number", minimum: 1 },
				span: {
					type: "object",
					properties: {
						startMs: { type: "number", minimum: 0 },
						endMs: { type: "number", minimum: 1 },
						start: { type: "number", minimum: 0 },
						end: { type: "number", minimum: 1 },
					},
					additionalProperties: false,
				},
				type: { enum: ANNOTATION_TYPES },
				content: { type: "string" },
				text: { type: "string" },
				imageDataUrl: { type: "string" },
				style: textStyleSchema,
				figureData: figureDataSchema,
				figure: figureDataSchema,
				position: positionSchema,
				size: sizeSchema,
				commit: { type: "boolean" },
			},
			additionalProperties: false,
		},
		handler: addAnnotationTool,
	},
	{
		name: "openscreen.annotations.setType",
		description: "Change annotation type while preserving type-specific content.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			required: ["type"],
			properties: {
				...idProperties,
				type: { enum: ANNOTATION_TYPES },
				commit: { type: "boolean" },
			},
			additionalProperties: false,
		},
		handler: setAnnotationTypeTool,
	},
	{
		name: "openscreen.annotations.setContent",
		description: "Set text content or supported image data URL content.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			required: ["content"],
			properties: {
				...idProperties,
				content: { type: "string" },
				type: { enum: ANNOTATION_TYPES },
				commit: { type: "boolean" },
			},
			additionalProperties: false,
		},
		handler: setAnnotationContentTool,
	},
	{
		name: "openscreen.annotations.setStyle",
		description: "Merge a partial text style into an annotation.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			properties: {
				...idProperties,
				style: textStyleSchema,
				...textStyleProperties,
				commit: { type: "boolean" },
			},
			additionalProperties: false,
		},
		handler: setAnnotationStyleTool,
	},
	{
		name: "openscreen.annotations.setFigure",
		description: "Set arrow annotation direction, stroke width, and color.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			properties: {
				...idProperties,
				figureData: figureDataSchema,
				...figureDataProperties,
				commit: { type: "boolean" },
			},
			additionalProperties: false,
		},
		handler: setAnnotationFigureTool,
	},
	{
		name: "openscreen.annotations.duplicate",
		description: "Duplicate an annotation using the editor +4 percent offset behavior.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			properties: idProperties,
			additionalProperties: false,
		},
		handler: duplicateAnnotationTool,
	},
	{
		name: "openscreen.annotations.delete",
		description: "Delete an annotation and clear editor selection when needed.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			properties: idProperties,
			additionalProperties: false,
		},
		handler: deleteAnnotationTool,
	},
	{
		name: "openscreen.customFonts.list",
		description: "List annotation custom fonts stored in the renderer localStorage.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
		handler: listCustomFontsTool,
	},
	{
		name: "openscreen.customFonts.add",
		description: "Add a Google Fonts import URL for annotation text.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			properties: {
				id: { type: "string" },
				name: { type: "string" },
				fontFamily: { type: "string" },
				importUrl: { type: "string" },
				url: { type: "string" },
			},
			additionalProperties: false,
		},
		handler: addCustomFontTool,
	},
	{
		name: "openscreen.customFonts.remove",
		description: "Remove an annotation custom font by id.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			properties: {
				id: { type: "string" },
				fontId: { type: "string" },
			},
			additionalProperties: false,
		},
		handler: removeCustomFontTool,
	},
];
