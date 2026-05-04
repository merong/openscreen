import { describe, expect, it, vi } from "vitest";
import type { ShortcutsPreferencesToolContext } from "../../electron/mcp/shortcutsPreferencesTools";
import {
	getLocaleTool,
	getPreferencesTool,
	getShortcutsTool,
	resetShortcutsTool,
	setPreferencesTool,
	setShortcutBindingTool,
	shortcutsPreferencesToolDefinitions,
	swapShortcutBindingTool,
} from "../../electron/mcp/shortcutsPreferencesTools";
import { DEFAULT_SHORTCUTS, type ShortcutsConfig } from "../lib/shortcuts";

function createContext(
	savedShortcuts: Partial<ShortcutsConfig> | null = null,
): ShortcutsPreferencesToolContext & {
	send: ReturnType<typeof vi.fn>;
	getShortcuts: ReturnType<typeof vi.fn>;
	saveShortcuts: ReturnType<typeof vi.fn>;
} {
	const send = vi.fn(async () => ({ accepted: true }));
	const getShortcuts = vi.fn(async () => savedShortcuts);
	const saveShortcuts = vi.fn(async () => ({ success: true }));
	return {
		commandBus: { send },
		shortcuts: {
			getShortcuts,
			saveShortcuts,
		},
		platform: { isMac: false },
		send,
		getShortcuts,
		saveShortcuts,
	};
}

describe("shortcuts/preferences/language MCP tools", () => {
	it("registers every new tool from the shortcuts/preferences/language feature document", () => {
		expect(shortcutsPreferencesToolDefinitions.map((tool) => tool.name)).toEqual([
			"openscreen.shortcuts.get",
			"openscreen.shortcuts.setBinding",
			"openscreen.shortcuts.swapBinding",
			"openscreen.shortcuts.reset",
			"openscreen.preferences.get",
			"openscreen.preferences.set",
			"openscreen.locale.get",
		]);
	});

	it("loads shortcuts with defaults, fixed shortcuts, and platform formatted labels", async () => {
		const context = createContext({ addZoom: { key: "k", ctrl: true } });
		const result = await getShortcutsTool({}, context);

		expect(result.structuredContent).toMatchObject({
			success: true,
			isMac: false,
			shortcuts: {
				addZoom: { key: "k", ctrl: true },
				addTrim: { key: "t" },
			},
			formattedShortcuts: {
				addZoom: {
					label: "Add Zoom",
					display: "Ctrl + K",
				},
			},
		});
		expect(context.getShortcuts).toHaveBeenCalled();
		expect(context.send).toHaveBeenCalledWith(
			"editor",
			"shortcuts.get",
			{
				includeFixed: true,
				includeFormatted: true,
			},
			{ ensureWindow: true, timeoutMs: 10_000 },
		);
	});

	it("rejects modifier-only, fixed-conflicting, and configurable-conflicting bindings", async () => {
		const context = createContext();
		const modifierOnly = await setShortcutBindingTool({ action: "addZoom", key: "ctrl" }, context);
		const fixedConflict = await setShortcutBindingTool(
			{ action: "addZoom", key: "z", primary: true },
			context,
		);
		const configurableConflict = await setShortcutBindingTool(
			{ action: "addTrim", key: "z" },
			context,
		);

		expect(modifierOnly.isError).toBe(true);
		expect(fixedConflict.structuredContent).toMatchObject({
			success: false,
			error: {
				code: "fixed_shortcut_conflict",
			},
		});
		expect(configurableConflict.structuredContent).toMatchObject({
			success: false,
			error: {
				code: "configurable_shortcut_conflict",
			},
		});
		expect(context.saveShortcuts).not.toHaveBeenCalled();
		expect(context.send).not.toHaveBeenCalled();
	});

	it("sets a valid binding, saves it, and applies it to the open renderer", async () => {
		const context = createContext();
		const result = await setShortcutBindingTool(
			{
				action: "addZoom",
				binding: { key: "k", primary: true, shift: true },
			},
			context,
		);

		const expectedShortcuts = {
			...DEFAULT_SHORTCUTS,
			addZoom: { key: "k", ctrl: true, shift: true },
		};
		expect(result.structuredContent).toMatchObject({
			success: true,
			action: "addZoom",
			binding: { key: "k", ctrl: true, shift: true },
			display: "Ctrl + Shift + K",
			shortcuts: expectedShortcuts,
		});
		expect(context.saveShortcuts).toHaveBeenCalledWith(expectedShortcuts);
		expect(context.send).toHaveBeenCalledWith(
			"editor",
			"shortcuts.apply",
			{
				shortcuts: expectedShortcuts,
				source: "mcp.setBinding",
			},
			{ ensureWindow: true, timeoutMs: 10_000 },
		);
	});

	it("swaps a binding with the configurable action that already uses it", async () => {
		const context = createContext();
		const result = await swapShortcutBindingTool({ action: "addTrim", key: "z" }, context);

		const expectedShortcuts = {
			...DEFAULT_SHORTCUTS,
			addZoom: { key: "t" },
			addTrim: { key: "z" },
		};
		expect(result.structuredContent).toMatchObject({
			success: true,
			action: "addTrim",
			binding: { key: "z" },
			swappedWith: "addZoom",
			swappedBinding: { key: "t" },
			shortcuts: expectedShortcuts,
		});
		expect(context.saveShortcuts).toHaveBeenCalledWith(expectedShortcuts);
		expect(context.send).toHaveBeenCalledWith(
			"editor",
			"shortcuts.apply",
			{
				shortcuts: expectedShortcuts,
				source: "mcp.swapBinding",
			},
			{ ensureWindow: true, timeoutMs: 10_000 },
		);
	});

	it("resets shortcuts to defaults and applies them immediately", async () => {
		const context = createContext({ addZoom: { key: "k" } });
		const result = await resetShortcutsTool({}, context);

		expect(result.structuredContent).toMatchObject({
			success: true,
			shortcuts: DEFAULT_SHORTCUTS,
		});
		expect(context.saveShortcuts).toHaveBeenCalledWith(DEFAULT_SHORTCUTS);
		expect(context.send).toHaveBeenCalledWith(
			"editor",
			"shortcuts.apply",
			{
				shortcuts: DEFAULT_SHORTCUTS,
				source: "mcp.reset",
			},
			{ ensureWindow: true, timeoutMs: 10_000 },
		);
	});

	it("gets user preferences through the renderer localStorage boundary", async () => {
		const context = createContext();
		const result = await getPreferencesTool({}, context);

		expect(result.structuredContent).toMatchObject({
			success: true,
			allowed: {
				padding: { min: 0, max: 100 },
				aspectRatios: ["16:9", "9:16", "1:1", "4:3", "4:5", "16:10", "10:16", "native"],
				exportQualities: ["medium", "good", "source"],
				exportFormats: ["mp4", "gif"],
			},
		});
		expect(context.send).toHaveBeenCalledWith(
			"editor",
			"preferences.get",
			{ includeAllowed: true },
			{ ensureWindow: true, timeoutMs: 10_000 },
		);
	});

	it("validates preferences before persisting and updating editor state", async () => {
		const context = createContext();
		const invalidPadding = await setPreferencesTool({ padding: 150 }, context);
		const invalidAspect = await setPreferencesTool({ aspectRatio: "21:9" }, context);
		const invalidQuality = await setPreferencesTool({ exportQuality: "high" }, context);
		const empty = await setPreferencesTool({}, context);
		const valid = await setPreferencesTool(
			{
				preferences: {
					padding: 72,
					aspectRatio: "9:16",
					exportQuality: "source",
					exportFormat: "gif",
				},
			},
			context,
		);

		expect(invalidPadding.isError).toBe(true);
		expect(invalidAspect.isError).toBe(true);
		expect(invalidQuality.isError).toBe(true);
		expect(empty.isError).toBe(true);
		expect(valid.structuredContent).toMatchObject({
			success: true,
			patch: {
				padding: 72,
				aspectRatio: "9:16",
				exportQuality: "source",
				exportFormat: "gif",
			},
			persistToLocalStorage: true,
			updateEditorState: true,
		});
		expect(context.send).toHaveBeenCalledTimes(1);
		expect(context.send).toHaveBeenCalledWith(
			"editor",
			"preferences.set",
			{
				patch: {
					padding: 72,
					aspectRatio: "9:16",
					exportQuality: "source",
					exportFormat: "gif",
				},
				persistToLocalStorage: true,
				updateEditorState: true,
			},
			{ ensureWindow: true, timeoutMs: 10_000 },
		);
	});

	it("gets locale metadata through the renderer i18n provider boundary", async () => {
		const context = createContext();
		const result = await getLocaleTool({}, context);

		expect(result.structuredContent).toMatchObject({
			success: true,
			defaultLocale: "en",
			supportedLocales: ["en", "zh-CN", "zh-TW", "es", "fr", "tr", "ko-KR", "ja-JP"],
			storageKey: "openscreen-locale",
			includeSystemSuggestion: true,
		});
		expect(context.send).toHaveBeenCalledWith(
			"editor",
			"locale.get",
			{ includeSystemSuggestion: true },
			{ ensureWindow: true, timeoutMs: 10_000 },
		);
	});
});
