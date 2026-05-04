import { describe, expect, it, vi } from "vitest";
import type { CropToolContext } from "../../electron/mcp/cropTools";
import {
	applyCropAspectPresetTool,
	cropToolDefinitions,
	resetCropTool,
	setNormalizedCropTool,
	setPixelCropTool,
} from "../../electron/mcp/cropTools";

function createContext(): CropToolContext & {
	send: ReturnType<typeof vi.fn>;
} {
	const send = vi.fn(async () => ({ accepted: true }));
	return {
		commandBus: { send },
		send,
	};
}

describe("crop MCP tools", () => {
	it("registers every tool from the crop editing feature document", () => {
		expect(cropToolDefinitions.map((tool) => tool.name)).toEqual([
			"openscreen.crop.get",
			"openscreen.crop.setNormalized",
			"openscreen.crop.setPixels",
			"openscreen.crop.applyAspectPreset",
			"openscreen.crop.reset",
		]);
	});

	it("normalizes crop region bounds for canonical normalized input", async () => {
		const context = createContext();
		const result = await setNormalizedCropTool(
			{ cropRegion: { x: -0.2, y: 0.9, width: 2, height: 0.001 }, commit: false },
			context,
		);

		expect(result.structuredContent).toMatchObject({
			success: true,
			cropRegion: {
				x: 0,
				y: 0.9,
				width: 1,
				height: 0.01,
			},
			commit: false,
		});
		expect(context.send).toHaveBeenCalledWith(
			"editor",
			"crop.setNormalized",
			{
				cropRegion: { x: 0, y: 0.9, width: 1, height: 0.01 },
				commit: false,
			},
			{ ensureWindow: true, timeoutMs: 10_000 },
		);
	});

	it("requires source video metadata for pixel crop input", async () => {
		const context = createContext();
		const result = await setPixelCropTool({ x: 10, y: 20, width: 100, height: 200 }, context);

		expect(result.isError).toBe(true);
		expect(context.send).not.toHaveBeenCalled();
		expect(result.structuredContent).toMatchObject({
			success: false,
			error: {
				code: "missing_video_metadata",
			},
		});
	});

	it("converts pixel crop into normalized crop using video dimensions", async () => {
		const context = createContext();
		const result = await setPixelCropTool(
			{ x: 100, y: 50, width: 400, height: 200, videoWidth: 1000, videoHeight: 500 },
			context,
		);

		expect(result.structuredContent).toMatchObject({
			success: true,
			cropRegion: {
				x: 0.1,
				y: 0.1,
				width: 0.4,
				height: 0.4,
			},
			videoWidth: 1000,
			videoHeight: 500,
		});
	});

	it("applies aspect presets with the same width-first calculation as SettingsPanel", async () => {
		const context = createContext();
		const result = await applyCropAspectPresetTool(
			{
				preset: "16:9",
				cropRegion: { x: 0, y: 0, width: 0.5, height: 0.8 },
				videoWidth: 1920,
				videoHeight: 1080,
			},
			context,
		);

		expect(result.structuredContent).toMatchObject({
			success: true,
			preset: "16:9",
			cropRegion: {
				x: 0,
				y: 0,
				width: 0.5,
				height: 0.5,
			},
		});
	});

	it("resets crop to the full source frame", async () => {
		const context = createContext();
		const result = await resetCropTool({ commit: false }, context);

		expect(result.structuredContent).toMatchObject({
			success: true,
			cropRegion: {
				x: 0,
				y: 0,
				width: 1,
				height: 1,
			},
			commit: false,
		});
	});
});
