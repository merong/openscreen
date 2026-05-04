import { describe, expect, it, vi } from "vitest";
import type { ExportToolContext } from "../../electron/mcp/exportTools";
import {
	cancelExportTool,
	exportToolDefinitions,
	getExportSettingsTool,
	revealExportTool,
	savePendingExportTool,
	setExportSettingsTool,
	startExportTool,
} from "../../electron/mcp/exportTools";

function createContext(): ExportToolContext & {
	send: ReturnType<typeof vi.fn>;
	revealInFolder: ReturnType<typeof vi.fn>;
} {
	const send = vi.fn(async () => ({ accepted: true }));
	const revealInFolder = vi.fn(async () => ({ success: true }));
	return {
		commandBus: { send },
		files: { revealInFolder },
		send,
		revealInFolder,
	};
}

describe("export settings MCP tools", () => {
	it("registers every tool from the export settings feature document", () => {
		expect(exportToolDefinitions.map((tool) => tool.name)).toEqual([
			"openscreen.export.settings.get",
			"openscreen.export.settings.set",
			"openscreen.export.start",
			"openscreen.export.cancel",
			"openscreen.export.savePending",
			"openscreen.export.reveal",
		]);
	});

	it("gets settings with calculated GIF dimensions and allowed values", async () => {
		const context = createContext();
		const result = await getExportSettingsTool({}, context);

		expect(result.structuredContent).toMatchObject({
			success: true,
			includeCalculatedGifDimensions: true,
			includeProgress: true,
			allowed: {
				formats: ["mp4", "gif"],
				qualities: ["medium", "good", "source"],
				gifFrameRates: [15, 20, 25, 30],
				gifSizePresets: ["medium", "large", "original"],
				saveModes: ["dialog"],
			},
		});
		expect(context.send).toHaveBeenCalledWith(
			"editor",
			"export.settings.get",
			{
				includeCalculatedGifDimensions: true,
				includeProgress: true,
			},
			{ ensureWindow: true, timeoutMs: 10_000 },
		);
	});

	it("sets export settings after normalizing aliases and nested GIF config", async () => {
		const context = createContext();
		const result = await setExportSettingsTool(
			{
				settings: {
					format: "gif",
					gifConfig: {
						frameRate: 30,
						loop: false,
						sizePreset: "large",
					},
				},
				persistToPreferences: false,
				commit: false,
			},
			context,
		);

		expect(result.structuredContent).toMatchObject({
			success: true,
			patch: {
				exportFormat: "gif",
				gifFrameRate: 30,
				gifLoop: false,
				gifSizePreset: "large",
			},
			persistToPreferences: false,
			commit: false,
		});
		expect(context.send).toHaveBeenCalledWith(
			"editor",
			"export.settings.set",
			{
				patch: {
					exportFormat: "gif",
					gifFrameRate: 30,
					gifLoop: false,
					gifSizePreset: "large",
				},
				persistToPreferences: false,
				commit: false,
			},
			{ ensureWindow: true, timeoutMs: 10_000 },
		);
	});

	it("rejects invalid or empty export setting updates", async () => {
		const context = createContext();
		const invalidQuality = await setExportSettingsTool({ quality: "high" }, context);
		const invalidFrameRate = await setExportSettingsTool({ format: "gif", frameRate: 12 }, context);
		const invalidLoop = await setExportSettingsTool({ gifLoop: "yes" }, context);
		const empty = await setExportSettingsTool({}, context);

		expect(invalidQuality.isError).toBe(true);
		expect(invalidFrameRate.isError).toBe(true);
		expect(invalidLoop.isError).toBe(true);
		expect(empty.isError).toBe(true);
		expect(context.send).not.toHaveBeenCalled();
	});

	it("starts export with current settings when no settings are supplied", async () => {
		const context = createContext();
		const result = await startExportTool({}, context);

		expect(result.structuredContent).toMatchObject({
			success: true,
			settings: {},
			useCurrentSettings: true,
			requireVideo: true,
			saveMode: "dialog",
			pendingBlobMayRemainOnSaveCancel: true,
		});
		expect(context.send).toHaveBeenCalledWith(
			"editor",
			"export.start",
			{
				settings: {},
				useCurrentSettings: true,
				requireVideo: true,
				saveMode: "dialog",
			},
			{ ensureWindow: true, timeoutMs: 3_600_000 },
		);
	});

	it("starts export with a validated settings patch", async () => {
		const context = createContext();
		const result = await startExportTool(
			{
				exportFormat: "mp4",
				exportQuality: "source",
			},
			context,
		);

		expect(result.structuredContent).toMatchObject({
			success: true,
			settings: {
				exportFormat: "mp4",
				exportQuality: "source",
			},
			useCurrentSettings: false,
		});
		expect(context.send).toHaveBeenCalledWith(
			"editor",
			"export.start",
			{
				settings: {
					exportFormat: "mp4",
					exportQuality: "source",
				},
				useCurrentSettings: false,
				requireVideo: true,
				saveMode: "dialog",
			},
			{ ensureWindow: true, timeoutMs: 3_600_000 },
		);
	});

	it("rejects non-dialog save targets because current export uses the save dialog", async () => {
		const context = createContext();
		const pathResult = await startExportTool({ filePath: "/tmp/out.mp4" }, context);
		const modeResult = await startExportTool({ saveMode: "path" }, context);

		expect(pathResult.isError).toBe(true);
		expect(modeResult.isError).toBe(true);
		expect(context.send).not.toHaveBeenCalled();
	});

	it("cancels active export and saves pending export through renderer commands", async () => {
		const context = createContext();
		const cancel = await cancelExportTool({}, context);
		const savePending = await savePendingExportTool({}, context);

		expect(cancel.structuredContent).toMatchObject({ success: true, allowNoop: true });
		expect(savePending.structuredContent).toMatchObject({
			success: true,
			saveMode: "dialog",
			pendingBlobRequired: true,
		});
		expect(context.send).toHaveBeenNthCalledWith(
			1,
			"editor",
			"export.cancel",
			{ allowNoop: true },
			{ ensureWindow: true, timeoutMs: 10_000 },
		);
		expect(context.send).toHaveBeenNthCalledWith(
			2,
			"editor",
			"export.savePending",
			{ saveMode: "dialog" },
			{ ensureWindow: true, timeoutMs: 60_000 },
		);
	});

	it("reveals a saved export through the main-process file service", async () => {
		const context = createContext();
		const result = await revealExportTool({ filePath: "/tmp/export.mp4" }, context);

		expect(result.structuredContent).toMatchObject({
			success: true,
			filePath: "/tmp/export.mp4",
		});
		expect(context.revealInFolder).toHaveBeenCalledWith("/tmp/export.mp4");
		expect(context.send).not.toHaveBeenCalled();
	});

	it("reports reveal service failures without falling back to renderer state", async () => {
		const context = createContext();
		context.revealInFolder.mockResolvedValueOnce({ success: false, message: "missing file" });
		const result = await revealExportTool({ path: "/tmp/missing.mp4" }, context);

		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({
			success: false,
			error: {
				code: "reveal_failed",
			},
		});
		expect(context.send).not.toHaveBeenCalled();
	});
});
