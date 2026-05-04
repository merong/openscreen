import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY, SUPPORTED_LOCALES } from "../../src/i18n/config";
import type { ExportFormat, ExportQuality } from "../../src/lib/exporter";
import {
	bindingsEqual,
	DEFAULT_SHORTCUTS,
	FIXED_SHORTCUTS,
	findConflict,
	formatBinding,
	mergeWithDefaults,
	SHORTCUT_ACTIONS,
	SHORTCUT_LABELS,
	type ShortcutAction,
	type ShortcutBinding,
	type ShortcutsConfig,
} from "../../src/lib/shortcuts";
import { ASPECT_RATIOS, type AspectRatio } from "../../src/utils/aspectRatioUtils";
import type { McpToolDefinition, McpToolResult, RendererCommandBus } from "./toolTypes";
import { toolFailure, toolSuccess } from "./toolTypes";

const FEATURE_DOCUMENT = "docs/user-editable-features/11-shortcuts-preferences-language.md";
const EXPORT_QUALITIES = ["medium", "good", "source"] as const;
const EXPORT_FORMATS = ["mp4", "gif"] as const;
const MODIFIER_ONLY_KEYS = new Set([
	"alt",
	"cmd",
	"command",
	"control",
	"ctrl",
	"meta",
	"option",
	"shift",
]);
const KEY_ALIASES: Record<string, string> = {
	del: "delete",
	esc: "escape",
	space: " ",
	spacebar: " ",
	left: "arrowleft",
	right: "arrowright",
	up: "arrowup",
	down: "arrowdown",
};

interface BasicResult {
	success: boolean;
	message?: string;
	error?: string;
}

interface UserPreferencesPatch {
	padding?: number;
	aspectRatio?: AspectRatio;
	exportQuality?: ExportQuality;
	exportFormat?: ExportFormat;
}

export interface ShortcutsPreferencesToolContext {
	commandBus: RendererCommandBus;
	shortcuts: {
		getShortcuts: () => Promise<Record<string, unknown> | null> | Record<string, unknown> | null;
		saveShortcuts: (shortcuts: ShortcutsConfig) => Promise<BasicResult> | BasicResult;
	};
	platform?: {
		isMac?: boolean;
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function optionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
	const value = args[key];
	return typeof value === "boolean" ? value : undefined;
}

function optionalFiniteNumber(args: Record<string, unknown>, key: string): number | undefined {
	const value = args[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getIsMac(context: ShortcutsPreferencesToolContext): boolean {
	return context.platform?.isMac ?? process.platform === "darwin";
}

function normalizeShortcutAction(value: unknown): ShortcutAction | null {
	return SHORTCUT_ACTIONS.includes(value as ShortcutAction) ? (value as ShortcutAction) : null;
}

function normalizeKey(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const lower = value.trim().toLowerCase();
	if (!lower || MODIFIER_ONLY_KEYS.has(lower)) {
		return null;
	}

	return KEY_ALIASES[lower] ?? lower;
}

function normalizeShortcutBinding(value: unknown): ShortcutBinding | null {
	if (!isRecord(value)) {
		return null;
	}

	const key = normalizeKey(value.key);
	if (!key) {
		return null;
	}

	return {
		key,
		...((optionalBoolean(value, "primary") ?? optionalBoolean(value, "ctrl"))
			? { ctrl: true }
			: {}),
		...(optionalBoolean(value, "shift") ? { shift: true } : {}),
		...(optionalBoolean(value, "alt") ? { alt: true } : {}),
	};
}

function getShortcutBindingInput(record: Record<string, unknown>): ShortcutBinding | null {
	if (isRecord(record.binding)) {
		return normalizeShortcutBinding(record.binding);
	}

	return normalizeShortcutBinding(record);
}

function normalizePersistedShortcuts(value: unknown): ShortcutsConfig {
	const record = isRecord(value) ? value : {};
	const partial: Partial<ShortcutsConfig> = {};
	for (const action of SHORTCUT_ACTIONS) {
		const binding = normalizeShortcutBinding(record[action]);
		if (binding) {
			partial[action] = binding;
		}
	}
	return mergeWithDefaults(partial);
}

async function getCurrentShortcutConfig(
	context: ShortcutsPreferencesToolContext,
): Promise<ShortcutsConfig> {
	const persisted = await context.shortcuts.getShortcuts();
	return normalizePersistedShortcuts(persisted);
}

function formatShortcutConfig(config: ShortcutsConfig, isMac: boolean) {
	return Object.fromEntries(
		SHORTCUT_ACTIONS.map((action) => [
			action,
			{
				action,
				label: SHORTCUT_LABELS[action],
				binding: config[action],
				display: formatBinding(config[action], isMac),
			},
		]),
	);
}

function formatFixedShortcuts(isMac: boolean) {
	return FIXED_SHORTCUTS.map((shortcut) => ({
		...shortcut,
		bindingDisplays: shortcut.bindings.map((binding) => formatBinding(binding, isMac)),
	}));
}

async function sendShortcutPreferenceCommand(
	context: ShortcutsPreferencesToolContext,
	method: string,
	args: unknown,
	timeoutMs = 10_000,
): Promise<unknown> {
	return context.commandBus.send("editor", method, args, {
		ensureWindow: true,
		timeoutMs,
	});
}

async function persistAndApplyShortcuts(
	context: ShortcutsPreferencesToolContext,
	config: ShortcutsConfig,
	source: string,
): Promise<{ saved: BasicResult; applied: unknown } | { error: McpToolResult }> {
	const saved = await context.shortcuts.saveShortcuts(config);
	if (!saved.success) {
		return {
			error: toolFailure(
				"shortcuts_save_failed",
				saved.message ?? saved.error ?? "Failed to save shortcuts.",
				{ result: saved },
			),
		};
	}

	const applied = await sendShortcutPreferenceCommand(context, "shortcuts.apply", {
		shortcuts: config,
		source,
	});
	return { saved, applied };
}

function findExactActionForBinding(
	config: ShortcutsConfig,
	binding: ShortcutBinding,
	exceptAction: ShortcutAction,
): ShortcutAction | null {
	for (const action of SHORTCUT_ACTIONS) {
		if (action !== exceptAction && bindingsEqual(config[action], binding)) {
			return action;
		}
	}
	return null;
}

function normalizeAspectRatio(value: unknown): AspectRatio | null {
	return ASPECT_RATIOS.includes(value as AspectRatio) ? (value as AspectRatio) : null;
}

function normalizeExportQuality(value: unknown): ExportQuality | null {
	return EXPORT_QUALITIES.includes(value as ExportQuality) ? (value as ExportQuality) : null;
}

function normalizeExportFormat(value: unknown): ExportFormat | null {
	return EXPORT_FORMATS.includes(value as ExportFormat) ? (value as ExportFormat) : null;
}

function getPreferencesSource(args: unknown): Record<string, unknown> {
	const record = isRecord(args) ? args : {};
	if (isRecord(record.preferences)) {
		return record.preferences;
	}
	if (isRecord(record.patch)) {
		return record.patch;
	}
	return record;
}

function normalizePreferencesPatch(
	args: unknown,
): { patch: UserPreferencesPatch; hasInput: boolean } | { error: McpToolResult } {
	const source = getPreferencesSource(args);
	const patch: UserPreferencesPatch = {};

	if ("padding" in source) {
		const padding = optionalFiniteNumber(source, "padding");
		if (padding === undefined || padding < 0 || padding > 100) {
			return {
				error: toolFailure("invalid_padding", "Pass padding as a number from 0 to 100.", {
					range: { min: 0, max: 100 },
				}),
			};
		}
		patch.padding = padding;
	}

	if ("aspectRatio" in source) {
		const aspectRatio = normalizeAspectRatio(source.aspectRatio);
		if (!aspectRatio) {
			return {
				error: toolFailure("invalid_aspect_ratio", "Pass a supported aspectRatio.", {
					supportedAspectRatios: [...ASPECT_RATIOS],
				}),
			};
		}
		patch.aspectRatio = aspectRatio;
	}

	if ("exportQuality" in source) {
		const exportQuality = normalizeExportQuality(source.exportQuality);
		if (!exportQuality) {
			return {
				error: toolFailure(
					"invalid_export_quality",
					"Pass exportQuality as medium, good, or source.",
					{ qualities: [...EXPORT_QUALITIES] },
				),
			};
		}
		patch.exportQuality = exportQuality;
	}

	if ("exportFormat" in source) {
		const exportFormat = normalizeExportFormat(source.exportFormat);
		if (!exportFormat) {
			return {
				error: toolFailure("invalid_export_format", "Pass exportFormat as mp4 or gif.", {
					formats: [...EXPORT_FORMATS],
				}),
			};
		}
		patch.exportFormat = exportFormat;
	}

	const hasInput = Object.keys(patch).length > 0;
	if (!hasInput) {
		return {
			error: toolFailure("missing_preferences", "Pass at least one preference to change."),
		};
	}

	return { patch, hasInput };
}

export async function getShortcutsTool(
	_args: unknown,
	context: ShortcutsPreferencesToolContext,
): Promise<McpToolResult> {
	const isMac = getIsMac(context);
	const shortcuts = await getCurrentShortcutConfig(context);
	const result = await sendShortcutPreferenceCommand(context, "shortcuts.get", {
		includeFixed: true,
		includeFormatted: true,
	});

	return toolSuccess(
		{
			success: true,
			isMac,
			actions: [...SHORTCUT_ACTIONS],
			shortcuts,
			formattedShortcuts: formatShortcutConfig(shortcuts, isMac),
			fixedShortcuts: formatFixedShortcuts(isMac),
			result,
		},
		"Shortcuts loaded.",
	);
}

export async function setShortcutBindingTool(
	args: unknown,
	context: ShortcutsPreferencesToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const action = normalizeShortcutAction(record.action);
	if (!action) {
		return toolFailure("invalid_shortcut_action", "Pass a configurable shortcut action.", {
			actions: [...SHORTCUT_ACTIONS],
		});
	}

	const binding = getShortcutBindingInput(record);
	if (!binding) {
		return toolFailure(
			"invalid_shortcut_binding",
			"Pass a shortcut binding with a non-modifier key.",
		);
	}

	const current = await getCurrentShortcutConfig(context);
	const conflict = findConflict(binding, action, current);
	if (conflict?.type === "fixed") {
		return toolFailure(
			"fixed_shortcut_conflict",
			"Shortcut conflicts with a fixed shortcut and cannot be assigned.",
			{ conflict },
		);
	}
	if (conflict?.type === "configurable") {
		return toolFailure(
			"configurable_shortcut_conflict",
			"Shortcut is already assigned to another configurable action; use swapBinding.",
			{ conflict, suggestedTool: "openscreen.shortcuts.swapBinding" },
		);
	}

	const next = { ...current, [action]: binding };
	const persisted = await persistAndApplyShortcuts(context, next, "mcp.setBinding");
	if ("error" in persisted) {
		return persisted.error;
	}

	const isMac = getIsMac(context);
	return toolSuccess(
		{
			success: true,
			action,
			binding,
			display: formatBinding(binding, isMac),
			shortcuts: next,
			saved: persisted.saved,
			result: persisted.applied,
		},
		"Shortcut binding set.",
	);
}

export async function swapShortcutBindingTool(
	args: unknown,
	context: ShortcutsPreferencesToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const action = normalizeShortcutAction(record.action);
	if (!action) {
		return toolFailure("invalid_shortcut_action", "Pass a configurable shortcut action.", {
			actions: [...SHORTCUT_ACTIONS],
		});
	}

	const binding = getShortcutBindingInput(record);
	if (!binding) {
		return toolFailure(
			"invalid_shortcut_binding",
			"Pass a shortcut binding with a non-modifier key.",
		);
	}

	const current = await getCurrentShortcutConfig(context);
	const conflict = findConflict(binding, action, current);
	if (conflict?.type === "fixed") {
		return toolFailure(
			"fixed_shortcut_conflict",
			"Shortcut conflicts with a fixed shortcut and cannot be swapped.",
			{ conflict },
		);
	}

	const conflictAction =
		conflict?.type === "configurable"
			? conflict.action
			: findExactActionForBinding(current, binding, action);
	if (!conflictAction) {
		return toolFailure(
			"no_configurable_shortcut_conflict",
			"swapBinding requires a configurable shortcut conflict; use setBinding instead.",
		);
	}

	const previousActionBinding = current[action];
	const next = {
		...current,
		[action]: binding,
		[conflictAction]: previousActionBinding,
	};
	const persisted = await persistAndApplyShortcuts(context, next, "mcp.swapBinding");
	if ("error" in persisted) {
		return persisted.error;
	}

	const isMac = getIsMac(context);
	return toolSuccess(
		{
			success: true,
			action,
			binding,
			display: formatBinding(binding, isMac),
			swappedWith: conflictAction,
			swappedBinding: previousActionBinding,
			shortcuts: next,
			saved: persisted.saved,
			result: persisted.applied,
		},
		"Shortcut binding swapped.",
	);
}

export async function resetShortcutsTool(
	_args: unknown,
	context: ShortcutsPreferencesToolContext,
): Promise<McpToolResult> {
	const next = { ...DEFAULT_SHORTCUTS };
	const persisted = await persistAndApplyShortcuts(context, next, "mcp.reset");
	if ("error" in persisted) {
		return persisted.error;
	}

	const isMac = getIsMac(context);
	return toolSuccess(
		{
			success: true,
			shortcuts: next,
			formattedShortcuts: formatShortcutConfig(next, isMac),
			saved: persisted.saved,
			result: persisted.applied,
		},
		"Shortcuts reset.",
	);
}

export async function getPreferencesTool(
	args: unknown,
	context: ShortcutsPreferencesToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const includeAllowed = optionalBoolean(record, "includeAllowed") ?? true;
	const result = await sendShortcutPreferenceCommand(context, "preferences.get", {
		includeAllowed,
	});

	return toolSuccess(
		{
			success: true,
			...(includeAllowed
				? {
						allowed: {
							padding: { min: 0, max: 100 },
							aspectRatios: [...ASPECT_RATIOS],
							exportQualities: [...EXPORT_QUALITIES],
							exportFormats: [...EXPORT_FORMATS],
						},
					}
				: {}),
			result,
		},
		"Preferences loaded.",
	);
}

export async function setPreferencesTool(
	args: unknown,
	context: ShortcutsPreferencesToolContext,
): Promise<McpToolResult> {
	const normalized = normalizePreferencesPatch(args);
	if ("error" in normalized) {
		return normalized.error;
	}

	const result = await sendShortcutPreferenceCommand(context, "preferences.set", {
		patch: normalized.patch,
		persistToLocalStorage: true,
		updateEditorState: true,
	});

	return toolSuccess(
		{
			success: true,
			patch: normalized.patch,
			persistToLocalStorage: true,
			updateEditorState: true,
			result,
		},
		"Preferences set.",
	);
}

export async function getLocaleTool(
	args: unknown,
	context: ShortcutsPreferencesToolContext,
): Promise<McpToolResult> {
	const record = isRecord(args) ? args : {};
	const includeSystemSuggestion = optionalBoolean(record, "includeSystemSuggestion") ?? true;
	const result = await sendShortcutPreferenceCommand(context, "locale.get", {
		includeSystemSuggestion,
	});

	return toolSuccess(
		{
			success: true,
			defaultLocale: DEFAULT_LOCALE,
			supportedLocales: [...SUPPORTED_LOCALES],
			storageKey: LOCALE_STORAGE_KEY,
			includeSystemSuggestion,
			result,
		},
		"Locale loaded.",
	);
}

const bindingSchema = {
	type: "object",
	required: ["key"],
	properties: {
		key: { type: "string" },
		ctrl: { type: "boolean" },
		primary: { type: "boolean" },
		shift: { type: "boolean" },
		alt: { type: "boolean" },
	},
	additionalProperties: false,
} as const;

const shortcutBindingInputProperties = {
	action: { enum: SHORTCUT_ACTIONS },
	binding: bindingSchema,
	key: { type: "string" },
	ctrl: { type: "boolean" },
	primary: { type: "boolean" },
	shift: { type: "boolean" },
	alt: { type: "boolean" },
} as const;

const preferencesPatchProperties = {
	padding: { type: "number", minimum: 0, maximum: 100 },
	aspectRatio: { enum: ASPECT_RATIOS },
	exportQuality: { enum: EXPORT_QUALITIES },
	exportFormat: { enum: EXPORT_FORMATS },
} as const;

const preferencesPatchSchema = {
	type: "object",
	properties: preferencesPatchProperties,
	additionalProperties: false,
} as const;

export const shortcutsPreferencesToolDefinitions: McpToolDefinition<ShortcutsPreferencesToolContext>[] =
	[
		{
			name: "openscreen.shortcuts.get",
			description: "Read configurable and fixed shortcut bindings with platform labels.",
			featureDocument: FEATURE_DOCUMENT,
			inputSchema: {
				type: "object",
				properties: {},
				additionalProperties: false,
			},
			handler: getShortcutsTool,
		},
		{
			name: "openscreen.shortcuts.setBinding",
			description: "Assign a configurable shortcut after rejecting fixed/configurable conflicts.",
			featureDocument: FEATURE_DOCUMENT,
			inputSchema: {
				type: "object",
				required: ["action"],
				properties: shortcutBindingInputProperties,
				additionalProperties: false,
			},
			handler: setShortcutBindingTool,
		},
		{
			name: "openscreen.shortcuts.swapBinding",
			description: "Swap two configurable shortcuts when a pending binding conflicts.",
			featureDocument: FEATURE_DOCUMENT,
			inputSchema: {
				type: "object",
				required: ["action"],
				properties: shortcutBindingInputProperties,
				additionalProperties: false,
			},
			handler: swapShortcutBindingTool,
		},
		{
			name: "openscreen.shortcuts.reset",
			description: "Reset configurable shortcuts to DEFAULT_SHORTCUTS and apply immediately.",
			featureDocument: FEATURE_DOCUMENT,
			inputSchema: {
				type: "object",
				properties: {},
				additionalProperties: false,
			},
			handler: resetShortcutsTool,
		},
		{
			name: "openscreen.preferences.get",
			description: "Read persisted user preferences from renderer localStorage.",
			featureDocument: FEATURE_DOCUMENT,
			inputSchema: {
				type: "object",
				properties: {
					includeAllowed: { type: "boolean" },
				},
				additionalProperties: false,
			},
			handler: getPreferencesTool,
		},
		{
			name: "openscreen.preferences.set",
			description: "Persist user preferences and update the open editor state together.",
			featureDocument: FEATURE_DOCUMENT,
			inputSchema: {
				type: "object",
				properties: {
					...preferencesPatchProperties,
					patch: preferencesPatchSchema,
					preferences: preferencesPatchSchema,
				},
				additionalProperties: false,
			},
			handler: setPreferencesTool,
		},
		{
			name: "openscreen.locale.get",
			description: "Read current locale metadata from the renderer i18n provider.",
			featureDocument: FEATURE_DOCUMENT,
			inputSchema: {
				type: "object",
				properties: {
					includeSystemSuggestion: { type: "boolean" },
				},
				additionalProperties: false,
			},
			handler: getLocaleTool,
		},
	];
