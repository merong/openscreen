import {
	clampPlaybackSpeed,
	DEFAULT_PLAYBACK_SPEED,
	DEFAULT_ZOOM_DEPTH,
	type Rotation3DPreset,
	type ZoomDepth,
	type ZoomFocusMode,
} from "../../src/components/video-editor/types";
import type { McpToolDefinition, McpToolResult, RendererCommandBus } from "./toolTypes";
import { toolFailure, toolSuccess } from "./toolTypes";

const FEATURE_DOCUMENT = "docs/user-editable-features/03-timeline-editing.md";
const MIN_TIMELINE_SPAN_MS = 100;
const MIN_DEFAULT_REGION_MS = 1_000;
const MAX_DEFAULT_REGION_MS = 30_000;
const ZOOM_DEPTHS = [1, 2, 3, 4, 5, 6] as const;
const ZOOM_FOCUS_MODES = ["manual", "auto"] as const;
const ROTATION_PRESETS = ["iso", "left", "right"] as const;

type RegionKind = "zoom" | "trim" | "speed" | "annotation" | "blur";

export interface TimelineToolContext {
	commandBus: RendererCommandBus;
}

interface NormalizedSpan {
	startMs: number;
	endMs: number;
	durationMs?: number;
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

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function normalizeDurationMs(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return undefined;
	}
	return Math.max(1, Math.round(value));
}

function defaultRegionDurationMs(durationMs?: number): number {
	if (!durationMs) {
		return MIN_DEFAULT_REGION_MS;
	}
	return clamp(
		Math.round(durationMs * 0.05),
		Math.min(MIN_DEFAULT_REGION_MS, durationMs),
		Math.min(MAX_DEFAULT_REGION_MS, durationMs),
	);
}

function normalizeTimeMs(value: number, durationMs?: number): number {
	const rounded = Math.max(0, Math.round(value));
	return durationMs ? clamp(rounded, 0, durationMs) : rounded;
}

function hasSpanInput(record: Record<string, unknown>): boolean {
	return (
		typeof record.startMs === "number" ||
		typeof record.endMs === "number" ||
		typeof record.timeMs === "number" ||
		typeof record.currentTimeMs === "number"
	);
}

function normalizeSpan(
	record: Record<string, unknown>,
	options?: { required?: boolean; minSpanMs?: number },
): NormalizedSpan | null {
	const durationMs = normalizeDurationMs(record.durationMs);
	if (!hasSpanInput(record)) {
		return options?.required ? null : null;
	}

	const minSpanMs = durationMs
		? Math.min(options?.minSpanMs ?? MIN_TIMELINE_SPAN_MS, durationMs)
		: (options?.minSpanMs ?? MIN_TIMELINE_SPAN_MS);
	if (minSpanMs <= 0) {
		return null;
	}

	const startInput =
		optionalFiniteNumber(record, "startMs") ??
		optionalFiniteNumber(record, "timeMs") ??
		optionalFiniteNumber(record, "currentTimeMs") ??
		0;
	const startMs = normalizeTimeMs(startInput, durationMs);
	const endInput =
		optionalFiniteNumber(record, "endMs") ?? startMs + defaultRegionDurationMs(durationMs);
	let endMs = normalizeTimeMs(endInput, durationMs);
	let normalizedStartMs = startMs;

	if (endMs - normalizedStartMs < minSpanMs) {
		endMs = normalizedStartMs + minSpanMs;
	}

	if (durationMs && endMs > durationMs) {
		endMs = durationMs;
		normalizedStartMs = Math.max(0, endMs - minSpanMs);
	}

	if (endMs <= normalizedStartMs) {
		return null;
	}

	return durationMs
		? { startMs: normalizedStartMs, endMs, durationMs }
		: { startMs: normalizedStartMs, endMs };
}

function normalizeRequiredId(record: Record<string, unknown>): string | null {
	return optionalString(record, "id") ?? optionalString(record, "regionId") ?? null;
}

function normalizeZoomDepth(value: unknown): ZoomDepth | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return undefined;
	}
	const rounded = clamp(Math.round(value), 1, 6) as ZoomDepth;
	return ZOOM_DEPTHS.includes(rounded) ? rounded : DEFAULT_ZOOM_DEPTH;
}

function normalizeFocus(value: unknown): { cx: number; cy: number } | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const cx = optionalFiniteNumber(value, "cx");
	const cy = optionalFiniteNumber(value, "cy");
	if (cx === undefined || cy === undefined) {
		return undefined;
	}
	return {
		cx: clamp(cx, 0, 1),
		cy: clamp(cy, 0, 1),
	};
}

function normalizeFocusMode(value: unknown): ZoomFocusMode | undefined {
	return ZOOM_FOCUS_MODES.includes(value as ZoomFocusMode) ? (value as ZoomFocusMode) : undefined;
}

function normalizeRotationPreset(value: unknown): Rotation3DPreset | null | undefined {
	if (value === null) {
		return null;
	}
	return ROTATION_PRESETS.includes(value as Rotation3DPreset)
		? (value as Rotation3DPreset)
		: undefined;
}

function normalizeZoomOptions(record: Record<string, unknown>): Record<string, unknown> {
	const depth = normalizeZoomDepth(record.depth);
	const focus = normalizeFocus(record.focus);
	const focusMode = normalizeFocusMode(record.focusMode);
	const rotationPreset = normalizeRotationPreset(record.rotationPreset);
	return {
		...(depth !== undefined ? { depth } : {}),
		...(focus ? { focus } : {}),
		...(focusMode ? { focusMode } : {}),
		...(rotationPreset !== undefined ? { rotationPreset } : {}),
	};
}

function normalizeSpeedOptions(record: Record<string, unknown>): Record<string, unknown> {
	const speed = optionalFiniteNumber(record, "speed");
	return {
		speed: speed === undefined ? DEFAULT_PLAYBACK_SPEED : clampPlaybackSpeed(speed),
	};
}

function normalizeTimelineRange(record: Record<string, unknown>): NormalizedSpan | null {
	return normalizeSpan(record, { required: true, minSpanMs: 1 });
}

async function sendTimelineCommand(
	context: TimelineToolContext,
	method: string,
	args: unknown,
	timeoutMs = 10_000,
): Promise<unknown> {
	return context.commandBus.send("editor", method, args, {
		ensureWindow: true,
		timeoutMs,
	});
}

async function addRegionTool(
	kind: RegionKind,
	args: unknown,
	context: TimelineToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const span = normalizeSpan(record);
	const durationMs = normalizeDurationMs(record.durationMs);
	const spanPayload = span
		? { span }
		: {
				useCurrentTime: true,
				...(durationMs ? { durationMs } : {}),
			};

	const options =
		kind === "zoom"
			? normalizeZoomOptions(record)
			: kind === "speed"
				? normalizeSpeedOptions(record)
				: {};
	const result = await sendTimelineCommand(context, `timeline.${kind}.add`, {
		...spanPayload,
		...options,
	});
	return toolSuccess(
		{ success: true, kind, ...spanPayload, ...options, result },
		`${kind} region added.`,
	);
}

async function updateRegionTool(
	kind: RegionKind,
	args: unknown,
	context: TimelineToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const id = normalizeRequiredId(record);
	if (!id) {
		return toolFailure("missing_id", "Pass id or regionId.");
	}

	const span = normalizeSpan(record);
	const options =
		kind === "zoom"
			? normalizeZoomOptions(record)
			: kind === "speed"
				? normalizeSpeedOptions(record)
				: {};
	if (!span && Object.keys(options).length === 0) {
		return toolFailure("empty_update", "Pass a span or editable region option.");
	}

	const payload = {
		id,
		...(span ? { span } : {}),
		...options,
	};
	const result = await sendTimelineCommand(context, `timeline.${kind}.update`, payload);
	return toolSuccess({ success: true, kind, ...payload, result }, `${kind} region updated.`);
}

async function deleteRegionTool(
	kind: RegionKind,
	args: unknown,
	context: TimelineToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const id = normalizeRequiredId(record);
	if (!id) {
		return toolFailure("missing_id", "Pass id or regionId.");
	}

	const result = await sendTimelineCommand(context, `timeline.${kind}.delete`, { id });
	return toolSuccess({ success: true, kind, id, result }, `${kind} region deleted.`);
}

export async function getTimelineStateTool(
	_args: unknown,
	context: TimelineToolContext,
): Promise<McpToolResult> {
	const result = await sendTimelineCommand(context, "timeline.state.get", {});
	return toolSuccess({ success: true, result }, "Timeline state loaded.");
}

export async function seekTimelineTool(
	args: unknown,
	context: TimelineToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const timeInput =
		optionalFiniteNumber(record, "timeMs") ??
		(optionalFiniteNumber(record, "seconds") !== undefined
			? optionalFiniteNumber(record, "seconds")! * 1000
			: undefined);
	if (timeInput === undefined) {
		return toolFailure("invalid_arguments", "Pass timeMs or seconds.");
	}

	const durationMs = normalizeDurationMs(record.durationMs);
	const timeMs = normalizeTimeMs(timeInput, durationMs);
	const result = await sendTimelineCommand(context, "timeline.seek", {
		timeMs,
		persisted: false,
	});
	return toolSuccess({ success: true, timeMs, persisted: false, result }, "Timeline seeked.");
}

export async function setTimelineRangeTool(
	args: unknown,
	context: TimelineToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const range = normalizeTimelineRange(record);
	if (!range) {
		return toolFailure("invalid_range", "Pass a valid timeline range.");
	}

	const result = await sendTimelineCommand(context, "timeline.range.set", {
		range,
		persisted: false,
	});
	return toolSuccess({ success: true, range, persisted: false, result }, "Timeline range set.");
}

export async function addZoomRegionTool(
	args: unknown,
	context: TimelineToolContext,
): Promise<McpToolResult> {
	return addRegionTool("zoom", args, context);
}

export async function suggestZoomRegionTool(
	args: unknown,
	context: TimelineToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const maxSuggestions = optionalFiniteNumber(record, "maxSuggestions");
	const minDwellMs = optionalFiniteNumber(record, "minDwellMs");
	const result = await sendTimelineCommand(context, "timeline.zoom.suggest", {
		...(maxSuggestions !== undefined
			? { maxSuggestions: Math.max(1, Math.round(maxSuggestions)) }
			: {}),
		...(minDwellMs !== undefined ? { minDwellMs: Math.max(0, Math.round(minDwellMs)) } : {}),
	});
	return toolSuccess({ success: true, result }, "Zoom suggestion requested.");
}

export async function updateZoomRegionTool(
	args: unknown,
	context: TimelineToolContext,
): Promise<McpToolResult> {
	return updateRegionTool("zoom", args, context);
}

export async function deleteZoomRegionTool(
	args: unknown,
	context: TimelineToolContext,
): Promise<McpToolResult> {
	return deleteRegionTool("zoom", args, context);
}

export async function addTrimRegionTool(
	args: unknown,
	context: TimelineToolContext,
): Promise<McpToolResult> {
	return addRegionTool("trim", args, context);
}

export async function updateTrimRegionTool(
	args: unknown,
	context: TimelineToolContext,
): Promise<McpToolResult> {
	return updateRegionTool("trim", args, context);
}

export async function deleteTrimRegionTool(
	args: unknown,
	context: TimelineToolContext,
): Promise<McpToolResult> {
	return deleteRegionTool("trim", args, context);
}

export async function addSpeedRegionTool(
	args: unknown,
	context: TimelineToolContext,
): Promise<McpToolResult> {
	return addRegionTool("speed", args, context);
}

export async function updateSpeedRegionTool(
	args: unknown,
	context: TimelineToolContext,
): Promise<McpToolResult> {
	return updateRegionTool("speed", args, context);
}

export async function deleteSpeedRegionTool(
	args: unknown,
	context: TimelineToolContext,
): Promise<McpToolResult> {
	return deleteRegionTool("speed", args, context);
}

export async function addAnnotationRegionTool(
	args: unknown,
	context: TimelineToolContext,
): Promise<McpToolResult> {
	return addRegionTool("annotation", args, context);
}

export async function updateAnnotationRegionTool(
	args: unknown,
	context: TimelineToolContext,
): Promise<McpToolResult> {
	return updateRegionTool("annotation", args, context);
}

export async function deleteAnnotationRegionTool(
	args: unknown,
	context: TimelineToolContext,
): Promise<McpToolResult> {
	return deleteRegionTool("annotation", args, context);
}

export async function addBlurRegionTool(
	args: unknown,
	context: TimelineToolContext,
): Promise<McpToolResult> {
	return addRegionTool("blur", args, context);
}

export async function updateBlurRegionTool(
	args: unknown,
	context: TimelineToolContext,
): Promise<McpToolResult> {
	return updateRegionTool("blur", args, context);
}

export async function deleteBlurRegionTool(
	args: unknown,
	context: TimelineToolContext,
): Promise<McpToolResult> {
	return deleteRegionTool("blur", args, context);
}

export async function listKeyframesTool(
	_args: unknown,
	context: TimelineToolContext,
): Promise<McpToolResult> {
	const result = await sendTimelineCommand(context, "timeline.keyframe.list", {});
	return toolSuccess({ success: true, persisted: false, result }, "Timeline keyframes loaded.");
}

export async function addKeyframeTool(
	args: unknown,
	context: TimelineToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const timeInput =
		optionalFiniteNumber(record, "timeMs") ?? optionalFiniteNumber(record, "currentTimeMs") ?? 0;
	const durationMs = normalizeDurationMs(record.durationMs);
	const timeMs = normalizeTimeMs(timeInput, durationMs);
	const result = await sendTimelineCommand(context, "timeline.keyframe.add", {
		timeMs,
		persisted: false,
	});
	return toolSuccess({ success: true, timeMs, persisted: false, result }, "Keyframe added.");
}

export async function updateKeyframeTool(
	args: unknown,
	context: TimelineToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const id = normalizeRequiredId(record);
	const timeInput = optionalFiniteNumber(record, "timeMs");
	if (!id || timeInput === undefined) {
		return toolFailure("invalid_arguments", "Pass id and timeMs.");
	}

	const durationMs = normalizeDurationMs(record.durationMs);
	const timeMs = normalizeTimeMs(timeInput, durationMs);
	const result = await sendTimelineCommand(context, "timeline.keyframe.update", {
		id,
		timeMs,
		persisted: false,
	});
	return toolSuccess({ success: true, id, timeMs, persisted: false, result }, "Keyframe updated.");
}

export async function deleteKeyframeTool(
	args: unknown,
	context: TimelineToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const id = normalizeRequiredId(record);
	const payload = id ? { id, persisted: false } : { selected: true, persisted: false };
	const result = await sendTimelineCommand(context, "timeline.keyframe.delete", payload);
	return toolSuccess({ success: true, ...payload, result }, "Keyframe deleted.");
}

const spanSchema = {
	startMs: { type: "number", minimum: 0 },
	endMs: { type: "number", minimum: 0 },
	timeMs: { type: "number", minimum: 0 },
	currentTimeMs: { type: "number", minimum: 0 },
	durationMs: { type: "number", minimum: 1 },
} as const;

const emptySchema = { type: "object", properties: {}, additionalProperties: false } as const;

function regionAddSchema(extraProperties: Record<string, unknown> = {}) {
	return {
		type: "object",
		properties: {
			...spanSchema,
			...extraProperties,
		},
		additionalProperties: false,
	};
}

function regionUpdateSchema(extraProperties: Record<string, unknown> = {}) {
	return {
		type: "object",
		required: ["id"],
		properties: {
			id: { type: "string" },
			regionId: { type: "string" },
			...spanSchema,
			...extraProperties,
		},
		additionalProperties: false,
	};
}

const deleteSchema = {
	type: "object",
	properties: {
		id: { type: "string" },
		regionId: { type: "string" },
	},
	additionalProperties: false,
} as const;

const zoomProperties = {
	depth: { type: "number", minimum: 1, maximum: 6 },
	focus: {
		type: "object",
		properties: {
			cx: { type: "number", minimum: 0, maximum: 1 },
			cy: { type: "number", minimum: 0, maximum: 1 },
		},
		additionalProperties: false,
	},
	focusMode: { enum: ZOOM_FOCUS_MODES },
	rotationPreset: { enum: [...ROTATION_PRESETS, null] },
} as const;

const speedProperties = {
	speed: { type: "number", minimum: 0.1, maximum: 16 },
} as const;

export const timelineToolDefinitions: McpToolDefinition<TimelineToolContext>[] = [
	{
		name: "openscreen.timeline.state",
		description: "Read saved timeline regions and temporary timeline UI state.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: emptySchema,
		handler: getTimelineStateTool,
	},
	{
		name: "openscreen.timeline.seek",
		description: "Move the preview playhead without marking the project dirty.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			properties: {
				timeMs: { type: "number", minimum: 0 },
				seconds: { type: "number", minimum: 0 },
				durationMs: { type: "number", minimum: 1 },
			},
			additionalProperties: false,
		},
		handler: seekTimelineTool,
	},
	{
		name: "openscreen.timeline.range.set",
		description: "Set the temporary timeline viewport range used for pan/zoom.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: regionAddSchema(),
		handler: setTimelineRangeTool,
	},
	{
		name: "openscreen.timeline.zoom.add",
		description: "Add a zoom region using the timeline default span rules.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: regionAddSchema(zoomProperties),
		handler: addZoomRegionTool,
	},
	{
		name: "openscreen.timeline.zoom.suggest",
		description: "Ask the editor to add cursor-dwell zoom suggestions when telemetry is available.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			properties: {
				maxSuggestions: { type: "number", minimum: 1 },
				minDwellMs: { type: "number", minimum: 0 },
			},
			additionalProperties: false,
		},
		handler: suggestZoomRegionTool,
	},
	{
		name: "openscreen.timeline.zoom.update",
		description:
			"Update a zoom region span, depth, focus mode, focus point, or 3D rotation preset.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: regionUpdateSchema(zoomProperties),
		handler: updateZoomRegionTool,
	},
	{
		name: "openscreen.timeline.zoom.delete",
		description: "Delete a zoom region and clear selection if needed.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: deleteSchema,
		handler: deleteZoomRegionTool,
	},
	{
		name: "openscreen.timeline.trim.add",
		description: "Add a trim region.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: regionAddSchema(),
		handler: addTrimRegionTool,
	},
	{
		name: "openscreen.timeline.trim.update",
		description: "Update a trim region span.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: regionUpdateSchema(),
		handler: updateTrimRegionTool,
	},
	{
		name: "openscreen.timeline.trim.delete",
		description: "Delete a trim region.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: deleteSchema,
		handler: deleteTrimRegionTool,
	},
	{
		name: "openscreen.timeline.speed.add",
		description: "Add a speed region with a preset or custom speed.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: regionAddSchema(speedProperties),
		handler: addSpeedRegionTool,
	},
	{
		name: "openscreen.timeline.speed.update",
		description: "Update a speed region span or playback speed.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: regionUpdateSchema(speedProperties),
		handler: updateSpeedRegionTool,
	},
	{
		name: "openscreen.timeline.speed.delete",
		description: "Delete a speed region.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: deleteSchema,
		handler: deleteSpeedRegionTool,
	},
	{
		name: "openscreen.timeline.annotation.add",
		description:
			"Add an annotation timeline region. Detailed annotation content uses annotation tools.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: regionAddSchema(),
		handler: addAnnotationRegionTool,
	},
	{
		name: "openscreen.timeline.annotation.update",
		description: "Update an annotation timeline span.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: regionUpdateSchema(),
		handler: updateAnnotationRegionTool,
	},
	{
		name: "openscreen.timeline.annotation.delete",
		description: "Delete an annotation timeline region.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: deleteSchema,
		handler: deleteAnnotationRegionTool,
	},
	{
		name: "openscreen.timeline.blur.add",
		description: "Add a blur timeline region.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: regionAddSchema(),
		handler: addBlurRegionTool,
	},
	{
		name: "openscreen.timeline.blur.update",
		description: "Update a blur timeline span.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: regionUpdateSchema(),
		handler: updateBlurRegionTool,
	},
	{
		name: "openscreen.timeline.blur.delete",
		description: "Delete a blur timeline region.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: deleteSchema,
		handler: deleteBlurRegionTool,
	},
	{
		name: "openscreen.timeline.keyframe.list",
		description: "Read temporary timeline keyframes. Keyframes are not saved or exported.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: emptySchema,
		handler: listKeyframesTool,
	},
	{
		name: "openscreen.timeline.keyframe.add",
		description: "Add a temporary keyframe marker.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			properties: {
				timeMs: { type: "number", minimum: 0 },
				currentTimeMs: { type: "number", minimum: 0 },
				durationMs: { type: "number", minimum: 1 },
			},
			additionalProperties: false,
		},
		handler: addKeyframeTool,
	},
	{
		name: "openscreen.timeline.keyframe.update",
		description: "Move a temporary keyframe marker.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: {
			type: "object",
			required: ["id", "timeMs"],
			properties: {
				id: { type: "string" },
				regionId: { type: "string" },
				timeMs: { type: "number", minimum: 0 },
				durationMs: { type: "number", minimum: 1 },
			},
			additionalProperties: false,
		},
		handler: updateKeyframeTool,
	},
	{
		name: "openscreen.timeline.keyframe.delete",
		description: "Delete a keyframe by id, or delete the selected keyframe when id is omitted.",
		featureDocument: FEATURE_DOCUMENT,
		inputSchema: deleteSchema,
		handler: deleteKeyframeTool,
	},
];
