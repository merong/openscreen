import { describe, expect, it, vi } from "vitest";
import type { LayoutEffectsToolContext } from "../../electron/mcp/layoutEffectsTools";
import {
	layoutEffectsToolDefinitions,
	setAspectRatioTool,
	setBackgroundTool,
	setEffectsTool,
	setWebcamLayoutTool,
	setWebcamSizeTool,
	uploadBackgroundImageTool,
} from "../../electron/mcp/layoutEffectsTools";

function createContext(): LayoutEffectsToolContext & {
	send: ReturnType<typeof vi.fn>;
} {
	const send = vi.fn(async () => ({ accepted: true }));
	return {
		commandBus: { send },
		send,
	};
}

describe("layout/effects/background MCP tools", () => {
	it("registers every tool from the layout/effects/background feature document", () => {
		expect(layoutEffectsToolDefinitions.map((tool) => tool.name)).toEqual([
			"openscreen.layout.getOptions",
			"openscreen.layout.setAspectRatio",
			"openscreen.layout.setWebcamLayout",
			"openscreen.layout.setWebcamMask",
			"openscreen.layout.setWebcamSize",
			"openscreen.effects.set",
			"openscreen.background.set",
			"openscreen.background.uploadImage",
		]);
	});

	it("resets incompatible webcam layout to PiP when changing aspect ratio", async () => {
		const context = createContext();
		const result = await setAspectRatioTool(
			{ aspectRatio: "16:9", currentWebcamLayoutPreset: "vertical-stack" },
			context,
		);

		expect(result.structuredContent).toMatchObject({
			success: true,
			patch: {
				aspectRatio: "16:9",
				webcamLayoutPreset: "picture-in-picture",
			},
			compatibilityAdjusted: true,
		});
		expect(context.send).toHaveBeenCalledWith(
			"editor",
			"layout.aspectRatio.set",
			{
				patch: {
					aspectRatio: "16:9",
					webcamLayoutPreset: "picture-in-picture",
				},
				compatibilityAdjusted: true,
			},
			{ ensureWindow: true, timeoutMs: 10_000 },
		);
	});

	it("clears webcamPosition for non-PiP webcam layouts", async () => {
		const context = createContext();
		const result = await setWebcamLayoutTool(
			{ webcamLayoutPreset: "dual-frame", aspectRatio: "16:9", position: { cx: 0.5, cy: 0.5 } },
			context,
		);

		expect(result.structuredContent).toMatchObject({
			success: true,
			patch: {
				webcamLayoutPreset: "dual-frame",
				webcamPosition: null,
			},
		});
	});

	it("rejects webcam layouts that are incompatible with a supplied aspect ratio", async () => {
		const context = createContext();
		const result = await setWebcamLayoutTool(
			{ webcamLayoutPreset: "dual-frame", aspectRatio: "9:16" },
			context,
		);

		expect(result.isError).toBe(true);
		expect(context.send).not.toHaveBeenCalled();
		expect(result.structuredContent).toMatchObject({
			success: false,
			error: {
				code: "layout_aspect_mismatch",
			},
		});
	});

	it("clamps webcam size and effect ranges before dispatch", async () => {
		const context = createContext();
		await setWebcamSizeTool({ size: 75, commit: false }, context);
		const effectsResult = await setEffectsTool(
			{
				showBlur: true,
				motionBlurAmount: -1,
				shadowIntensity: 2,
				borderRadius: 30,
				padding: -20,
			},
			context,
		);

		expect(context.send).toHaveBeenNthCalledWith(
			1,
			"editor",
			"layout.webcamSize.set",
			{
				patch: { webcamSizePreset: 50 },
				commit: false,
			},
			{ ensureWindow: true, timeoutMs: 10_000 },
		);
		expect(effectsResult.structuredContent).toMatchObject({
			success: true,
			patch: {
				showBlur: true,
				motionBlurAmount: 0,
				shadowIntensity: 1,
				borderRadius: 16,
				padding: 0,
			},
		});
	});

	it("canonicalizes bundled wallpapers and rejects file URLs", async () => {
		const context = createContext();
		const result = await setBackgroundTool({ wallpaper: "/wallpapers/wallpaper2.jpg" }, context);
		const rejected = await setBackgroundTool({ wallpaper: "file:///tmp/background.jpg" }, context);

		expect(result.structuredContent).toMatchObject({
			success: true,
			patch: { wallpaper: "/wallpapers/wallpaper2.jpg" },
			kind: "image",
		});
		expect(rejected.isError).toBe(true);
		expect(rejected.structuredContent).toMatchObject({
			success: false,
			error: {
				code: "invalid_wallpaper",
			},
		});
	});

	it("accepts only JPEG/JPG data URLs for background uploads", async () => {
		const context = createContext();
		const pngResult = await uploadBackgroundImageTool(
			{ dataUrl: "data:image/png;base64,AAAA" },
			context,
		);
		const jpgResult = await uploadBackgroundImageTool(
			{ dataUrl: "data:image/jpeg;base64,AAAA" },
			context,
		);

		expect(pngResult.isError).toBe(true);
		expect(jpgResult.structuredContent).toMatchObject({
			success: true,
			patch: { wallpaper: "data:image/jpeg;base64,AAAA" },
			kind: "image",
		});
	});
});
