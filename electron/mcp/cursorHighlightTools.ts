import type { CursorTelemetryPoint } from "../../src/components/video-editor/types";
import {
	CURSOR_HIGHLIGHT_MAX_SIZE_PX,
	CURSOR_HIGHLIGHT_MIN_SIZE_PX,
	CURSOR_HIGHLIGHT_OFFSET_RANGE,
	type CursorHighlightConfig,
	type CursorHighlightStyle,
	DEFAULT_CURSOR_HIGHLIGHT,
} from "../../src/components/video-editor/videoPlayback/cursorHighlight";
import type { McpToolDefinition, McpToolResult, RendererCommandBus } from "./toolTypes";
import { toolFailure, toolSuccess } from "./toolTypes";

const FEATURE_DOCUMENT = "docs/user-editable-features/07-cursor-highlight.md";
const CURSOR_HIGHLIGHT_STYLES = ["dot", "ring"] as const;
const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const EXTENDED_OFFSET_RANGE = 1;

interface CursorTelemetryResult {
	success: boolean;
	samples?: CursorTelemetryPoint[];
	clicks?: number[];
	message?: string;
	error?: string;
}

interface AccessibilityPermissionResult {
	success: boolean;
	granted: boolean;
	status?: string;
	error?: string;
}

export interface CursorHighlightToolContext {
	commandBus: RendererCommandBus;
	platform?: NodeJS.Platform | string | { name?: NodeJS.Platform | string };
	media?: {
		getCursorTelemetry?: (
			videoPath?: string,
		) => Promise<CursorTelemetryResult> | CursorTelemetryResult;
	};
	permissions?: {
		requestAccessibilityAccess?: () =>
			| Promise<AccessibilityPermissionResult>
			| AccessibilityPermissionResult;
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

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function getPlatform(context: CursorHighlightToolContext): string {
	if (context.platform && typeof context.platform === "object") {
		return context.platform.name ?? process.platform;
	}
	return context.platform ?? process.platform;
}

function supportsClickOnly(context: CursorHighlightToolContext): boolean {
	return getPlatform(context) === "darwin";
}

function normalizeStyle(value: unknown): CursorHighlightStyle | null {
	return CURSOR_HIGHLIGHT_STYLES.includes(value as CursorHighlightStyle)
		? (value as CursorHighlightStyle)
		: null;
}

function normalizeColor(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	return HEX_COLOR_RE.test(trimmed) ? trimmed : null;
}

function getOffsetRange(record: Record<string, unknown>): number {
	return optionalBoolean(record, "allowExtendedOffsetRange")
		? EXTENDED_OFFSET_RANGE
		: CURSOR_HIGHLIGHT_OFFSET_RANGE;
}

function getConfigInput(record: Record<string, unknown>): Record<string, unknown> {
	return isRecord(record.cursorHighlight)
		? record.cursorHighlight
		: isRecord(record.config)
			? record.config
			: record;
}

function normalizeFullCursorHighlight(
	value: unknown,
	offsetRange: number,
): { cursorHighlight: CursorHighlightConfig } | { error: McpToolResult } {
	if (!isRecord(value)) {
		return { cursorHighlight: { ...DEFAULT_CURSOR_HIGHLIGHT } };
	}

	const style =
		value.style === undefined ? DEFAULT_CURSOR_HIGHLIGHT.style : normalizeStyle(value.style);
	if (!style) {
		return {
			error: toolFailure("invalid_cursor_highlight_style", "Pass style as dot or ring.", {
				supportedStyles: [...CURSOR_HIGHLIGHT_STYLES],
			}),
		};
	}

	const color =
		value.color === undefined ? DEFAULT_CURSOR_HIGHLIGHT.color : normalizeColor(value.color);
	if (!color) {
		return toolFailureWithColor();
	}

	const sizePx = optionalFiniteNumber(value, "sizePx");
	const opacity = optionalFiniteNumber(value, "opacity");
	const clickEmphasisDurationMs = optionalFiniteNumber(value, "clickEmphasisDurationMs");
	const offsetXNorm = optionalFiniteNumber(value, "offsetXNorm");
	const offsetYNorm = optionalFiniteNumber(value, "offsetYNorm");

	return {
		cursorHighlight: {
			enabled: optionalBoolean(value, "enabled") ?? DEFAULT_CURSOR_HIGHLIGHT.enabled,
			style,
			sizePx:
				sizePx === undefined
					? DEFAULT_CURSOR_HIGHLIGHT.sizePx
					: clamp(sizePx, CURSOR_HIGHLIGHT_MIN_SIZE_PX, CURSOR_HIGHLIGHT_MAX_SIZE_PX),
			color,
			opacity: opacity === undefined ? DEFAULT_CURSOR_HIGHLIGHT.opacity : clamp(opacity, 0, 1),
			onlyOnClicks: optionalBoolean(value, "onlyOnClicks") ?? DEFAULT_CURSOR_HIGHLIGHT.onlyOnClicks,
			clickEmphasisDurationMs:
				clickEmphasisDurationMs === undefined
					? DEFAULT_CURSOR_HIGHLIGHT.clickEmphasisDurationMs
					: Math.max(1, clickEmphasisDurationMs),
			offsetXNorm:
				offsetXNorm === undefined
					? DEFAULT_CURSOR_HIGHLIGHT.offsetXNorm
					: clamp(offsetXNorm, -offsetRange, offsetRange),
			offsetYNorm:
				offsetYNorm === undefined
					? DEFAULT_CURSOR_HIGHLIGHT.offsetYNorm
					: clamp(offsetYNorm, -offsetRange, offsetRange),
		},
	};
}

function toolFailureWithColor(): { error: McpToolResult } {
	return {
		error: toolFailure("invalid_cursor_highlight_color", "Pass color as #RGB or #RRGGBB."),
	};
}

function normalizeCursorHighlightPatch(
	value: unknown,
	offsetRange: number,
): { patch: Partial<CursorHighlightConfig> } | { error: McpToolResult } {
	if (!isRecord(value)) {
		return { error: toolFailure("invalid_arguments", "Pass cursor highlight fields to patch.") };
	}

	const patch: Partial<CursorHighlightConfig> = {};

	if ("enabled" in value) {
		if (typeof value.enabled !== "boolean") {
			return { error: toolFailure("invalid_enabled", "Pass enabled as a boolean.") };
		}
		patch.enabled = value.enabled;
	}

	if ("style" in value) {
		const style = normalizeStyle(value.style);
		if (!style) {
			return {
				error: toolFailure("invalid_cursor_highlight_style", "Pass style as dot or ring.", {
					supportedStyles: [...CURSOR_HIGHLIGHT_STYLES],
				}),
			};
		}
		patch.style = style;
	}

	if ("sizePx" in value) {
		const sizePx = optionalFiniteNumber(value, "sizePx");
		if (sizePx === undefined) {
			return { error: toolFailure("invalid_size", "Pass sizePx as a finite number.") };
		}
		patch.sizePx = clamp(sizePx, CURSOR_HIGHLIGHT_MIN_SIZE_PX, CURSOR_HIGHLIGHT_MAX_SIZE_PX);
	}

	if ("color" in value) {
		const color = normalizeColor(value.color);
		if (!color) {
			return toolFailureWithColor();
		}
		patch.color = color;
	}

	if ("opacity" in value) {
		const opacity = optionalFiniteNumber(value, "opacity");
		if (opacity === undefined) {
			return { error: toolFailure("invalid_opacity", "Pass opacity as a finite number.") };
		}
		patch.opacity = clamp(opacity, 0, 1);
	}

	if ("onlyOnClicks" in value) {
		if (typeof value.onlyOnClicks !== "boolean") {
			return { error: toolFailure("invalid_only_on_clicks", "Pass onlyOnClicks as a boolean.") };
		}
		patch.onlyOnClicks = value.onlyOnClicks;
	}

	if ("clickEmphasisDurationMs" in value) {
		const duration = optionalFiniteNumber(value, "clickEmphasisDurationMs");
		if (duration === undefined) {
			return {
				error: toolFailure(
					"invalid_click_emphasis_duration",
					"Pass clickEmphasisDurationMs as a finite number.",
				),
			};
		}
		patch.clickEmphasisDurationMs = Math.max(1, duration);
	}

	if ("offsetXNorm" in value) {
		const offset = optionalFiniteNumber(value, "offsetXNorm");
		if (offset === undefined) {
			return { error: toolFailure("invalid_offset", "Pass offsetXNorm as a finite number.") };
		}
		patch.offsetXNorm = clamp(offset, -offsetRange, offsetRange);
	}

	if ("offsetYNorm" in value) {
		const offset = optionalFiniteNumber(value, "offsetYNorm");
		if (offset === undefined) {
			return { error: toolFailure("invalid_offset", "Pass offsetYNorm as a finite number.") };
		}
		patch.offsetYNorm = clamp(offset, -offsetRange, offsetRange);
	}

	if (Object.keys(patch).length === 0) {
		return {
			error: toolFailure("empty_cursor_highlight_patch", "Pass at least one field to patch."),
		};
	}

	return { patch };
}

function getEffectiveCursorHighlight(
	cursorHighlight: CursorHighlightConfig,
	context: CursorHighlightToolContext,
): CursorHighlightConfig {
	return supportsClickOnly(context) ? cursorHighlight : { ...cursorHighlight, onlyOnClicks: false };
}

async function requestClickPermissionIfNeeded(
	context: CursorHighlightToolContext,
	turningOnClickOnly: boolean,
): Promise<AccessibilityPermissionResult | null> {
	if (!turningOnClickOnly || !supportsClickOnly(context)) {
		return null;
	}

	const request = context.permissions?.requestAccessibilityAccess;
	if (!request) {
		return {
			success: false,
			granted: false,
			error: "Accessibility permission request is not wired.",
		};
	}

	return await request();
}

function summarizeTelemetry(result: CursorTelemetryResult): {
	hasCursorTelemetry: boolean;
	sampleCount: number;
	clickCount: number;
} {
	const samples = Array.isArray(result.samples) ? result.samples : [];
	const clicks = Array.isArray(result.clicks) ? result.clicks : [];
	return {
		hasCursorTelemetry: samples.length > 0,
		sampleCount: samples.length,
		clickCount: clicks.length,
	};
}

async function sendCursorHighlightCommand(
	context: CursorHighlightToolContext,
	method: string,
	args: unknown,
	timeoutMs = 10_000,
): Promise<unknown> {
	return context.commandBus.send("editor", method, args, {
		ensureWindow: true,
		timeoutMs,
	});
}

export async function getCursorTelemetryTool(
	args: unknown,
	context: CursorHighlightToolContext,
): Promise<McpToolResult> {
	const getTelemetry = context.media?.getCursorTelemetry;
	if (!getTelemetry) {
		return toolFailure(
			"cursor_telemetry_unavailable",
			"Cursor telemetry access is not wired in this MCP context.",
		);
	}

	const record = isRecord(args) ? args : {};
	const videoPath = optionalString(record, "videoPath");
	const includeSamples = optionalBoolean(record, "includeSamples") ?? false;
	const result = await getTelemetry(videoPath);
	const samples = Array.isArray(result.samples) ? result.samples : [];
	const clicks = Array.isArray(result.clicks) ? result.clicks : [];

	return toolSuccess(
		{
			success: result.success,
			...summarizeTelemetry(result),
			...(videoPath ? { videoPath } : {}),
			...(includeSamples ? { samples, clicks } : {}),
			...(result.message ? { message: result.message } : {}),
			...(result.error ? { error: result.error } : {}),
		},
		"Cursor telemetry loaded.",
	);
}

export async function getCursorHighlightTool(
	_args: unknown,
	context: CursorHighlightToolContext,
): Promise<McpToolResult> {
	const platform = getPlatform(context);
	const supportsClickTelemetry = supportsClickOnly(context);
	const result = await sendCursorHighlightCommand(context, "cursorHighlight.get", {
		platform,
		supportsClickTelemetry,
	});

	return toolSuccess(
		{
			success: true,
			platform,
			supportsClickTelemetry,
			result,
		},
		"Cursor highlight state loaded.",
	);
}

export async function setCursorHighlightTool(
	args: unknown,
	context: CursorHighlightToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const offsetRange = getOffsetRange(record);
	const normalized = normalizeFullCursorHighlight(getConfigInput(record), offsetRange);
	if ("error" in normalized) {
		return normalized.error;
	}

	const commit = optionalBoolean(record, "commit") ?? true;
	const permission = await requestClickPermissionIfNeeded(
		context,
		normalized.cursorHighlight.onlyOnClicks,
	);
	const effectiveCursorHighlight = getEffectiveCursorHighlight(normalized.cursorHighlight, context);
	const result = await sendCursorHighlightCommand(context, "cursorHighlight.set", {
		cursorHighlight: normalized.cursorHighlight,
		effectiveCursorHighlight,
		commit,
	});

	return toolSuccess(
		{
			success: true,
			cursorHighlight: normalized.cursorHighlight,
			effectiveCursorHighlight,
			commit,
			offsetRange,
			supportsClickTelemetry: supportsClickOnly(context),
			clickOnlyRenderEffective: effectiveCursorHighlight.onlyOnClicks,
			...(permission
				? {
						permission: {
							...permission,
							needsUserAction: !permission.granted,
						},
					}
				: {}),
			result,
		},
		"Cursor highlight set.",
	);
}

export async function patchCursorHighlightTool(
	args: unknown,
	context: CursorHighlightToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const offsetRange = getOffsetRange(record);
	const patchInput = isRecord(record.patch) ? record.patch : getConfigInput(record);
	const normalized = normalizeCursorHighlightPatch(patchInput, offsetRange);
	if ("error" in normalized) {
		return normalized.error;
	}

	const commit = optionalBoolean(record, "commit") ?? true;
	const permission = await requestClickPermissionIfNeeded(
		context,
		normalized.patch.onlyOnClicks === true,
	);
	const result = await sendCursorHighlightCommand(context, "cursorHighlight.patch", {
		patch: normalized.patch,
		commit,
		platform: getPlatform(context),
		supportsClickTelemetry: supportsClickOnly(context),
	});

	return toolSuccess(
		{
			success: true,
			patch: normalized.patch,
			commit,
			offsetRange,
			supportsClickTelemetry: supportsClickOnly(context),
			clickOnlyRenderEffective:
				normalized.patch.onlyOnClicks === true ? supportsClickOnly(context) : undefined,
			...(permission
				? {
						permission: {
							...permission,
							needsUserAction: !permission.granted,
						},
					}
				: {}),
			result,
		},
		"Cursor highlight patched.",
	);
}

export async function requestCursorClickPermissionTool(
	_args: unknown,
	context: CursorHighlightToolContext,
): Promise<McpToolResult> {
	if (!supportsClickOnly(context)) {
		return toolSuccess(
			{
				success: true,
				granted: true,
				platform: getPlatform(context),
				supportsClickTelemetry: false,
				needsUserAction: false,
			},
			"Click-only cursor highlight is not platform-gated here.",
		);
	}

	const request = context.permissions?.requestAccessibilityAccess;
	if (!request) {
		return toolFailure(
			"accessibility_permission_unavailable",
			"Accessibility permission request is not wired in this MCP context.",
		);
	}

	const result = await request();
	return toolSuccess(
		{
			...result,
			platform: getPlatform(context),
			supportsClickTelemetry: true,
			needsUserAction: !result.granted,
		},
		result.granted ? "Accessibility permission granted." : "Accessibility permission requested.",
	);
}

const cursorHighlightProperties = {
	enabled: { type: "boolean" },
	style: { enum: CURSOR_HIGHLIGHT_STYLES },
	sizePx: {
		type: "number",
		minimum: CURSOR_HIGHLIGHT_MIN_SIZE_PX,
		maximum: CURSOR_HIGHLIGHT_MAX_SIZE_PX,
	},
	color: { type: "string", pattern: "^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$" },
	opacity: { type: "number", minimum: 0, maximum: 1 },
	onlyOnClicks: { type: "boolean" },
	clickEmphasisDurationMs: { type: "number", minimum: 1 },
	offsetXNorm: { type: "number", minimum: -1, maximum: 1 },
	offsetYNorm: { type: "number", minimum: -1, maximum: 1 },
	allowExtendedOffsetRange: { type: "boolean" },
	commit: { type: "boolean" },
} as const;

const cursorHighlightConfigSchema = {
	type: "object",
	properties: cursorHighlightProperties,
	additionalProperties: false,
} as const;

export const cursorHighlightToolDefinitions: McpToolDefinition<CursorHighlightToolContext>[] = [
	{
		name: "openscreen.cursorTelemetry.get",
		description: "Read cursor telemetry samples/clicks for the current or provided video path.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			properties: {
				videoPath: { type: "string" },
				includeSamples: { type: "boolean" },
			},
			additionalProperties: false,
		},
		handler: getCursorTelemetryTool,
	},
	{
		name: "openscreen.cursorHighlight.get",
		description: "Read cursor highlight state and platform support metadata.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
		handler: getCursorHighlightTool,
	},
	{
		name: "openscreen.cursorHighlight.set",
		description: "Set the full cursor highlight config with project-compatible normalization.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			properties: {
				cursorHighlight: cursorHighlightConfigSchema,
				config: cursorHighlightConfigSchema,
				...cursorHighlightProperties,
			},
			additionalProperties: false,
		},
		handler: setCursorHighlightTool,
	},
	{
		name: "openscreen.cursorHighlight.patch",
		description: "Patch selected cursor highlight fields using UI-compatible ranges.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			properties: {
				patch: cursorHighlightConfigSchema,
				cursorHighlight: cursorHighlightConfigSchema,
				config: cursorHighlightConfigSchema,
				...cursorHighlightProperties,
			},
			additionalProperties: false,
		},
		handler: patchCursorHighlightTool,
	},
	{
		name: "openscreen.cursorHighlight.requestClickPermission",
		description: "Request macOS Accessibility permission for click-only cursor highlighting.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
		handler: requestCursorClickPermissionTool,
	},
];
