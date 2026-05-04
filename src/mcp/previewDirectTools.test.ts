import { describe, expect, it, vi } from "vitest";
import type { PreviewDirectToolContext } from "../../electron/mcp/previewDirectTools";
import {
	previewDirectToolDefinitions,
	setAnnotationPositionTool,
	setAnnotationSizeTool,
	setBlurFreehandTool,
	setPreviewFullscreenTool,
	setWebcamPositionTool,
	setZoomFocusTool,
} from "../../electron/mcp/previewDirectTools";

function createContext(): PreviewDirectToolContext & {
	send: ReturnType<typeof vi.fn>;
} {
	const send = vi.fn(async () => ({ accepted: true }));
	return {
		commandBus: { send },
		send,
	};
}

describe("preview direct editing MCP tools", () => {
	it("registers every tool from the preview direct editing feature document", () => {
		expect(previewDirectToolDefinitions.map((tool) => tool.name)).toEqual([
			"openscreen.preview.state",
			"openscreen.zoom.focus.set",
			"openscreen.webcam.position.set",
			"openscreen.annotation.position.set",
			"openscreen.annotation.size.set",
			"openscreen.blur.freehand.set",
			"openscreen.preview.fullscreen.set",
		]);
	});

	it("normalizes zoom focus coordinates and sends an explicit commit flag", async () => {
		const context = createContext();
		const result = await setZoomFocusTool(
			{
				id: "zoom-1",
				focus: { cx: 1.5, cy: -0.5 },
				allowAutoFocusOverride: true,
				commit: false,
			},
			context,
		);

		expect(result.structuredContent).toMatchObject({
			success: true,
			id: "zoom-1",
			focus: { cx: 1, cy: 0 },
			allowAutoFocusOverride: true,
			commit: false,
		});
		expect(context.send).toHaveBeenCalledWith(
			"editor",
			"preview.zoom.focus.set",
			{
				id: "zoom-1",
				focus: { cx: 1, cy: 0 },
				allowAutoFocusOverride: true,
				commit: false,
			},
			{ ensureWindow: true, timeoutMs: 10_000 },
		);
	});

	it("normalizes PiP webcam position and keeps PiP validation enabled by default", async () => {
		const context = createContext();
		const result = await setWebcamPositionTool({ position: { cx: -1, cy: 2 } }, context);

		expect(result.structuredContent).toMatchObject({
			success: true,
			position: { cx: 0, cy: 1 },
			requirePictureInPicture: true,
			commit: true,
		});
	});

	it("clamps annotation position and size percentages", async () => {
		const context = createContext();
		await setAnnotationPositionTool({ id: "annotation-1", position: { x: -20, y: 140 } }, context);
		const sizeResult = await setAnnotationSizeTool(
			{ id: "annotation-1", size: { width: 0, height: 300 } },
			context,
		);

		expect(context.send).toHaveBeenNthCalledWith(
			1,
			"editor",
			"preview.annotation.position.set",
			{ id: "annotation-1", position: { x: 0, y: 100 } },
			{ ensureWindow: true, timeoutMs: 10_000 },
		);
		expect(sizeResult.structuredContent).toMatchObject({
			success: true,
			size: { width: 1, height: 200 },
		});
	});

	it("rejects freehand blur paths with too few valid points", async () => {
		const context = createContext();
		const result = await setBlurFreehandTool(
			{
				id: "annotation-2",
				freehandPoints: [
					{ x: 0, y: 0 },
					{ x: 50, y: 50 },
				],
			},
			context,
		);

		expect(result.isError).toBe(true);
		expect(context.send).not.toHaveBeenCalled();
		expect(result.structuredContent).toMatchObject({
			success: false,
			error: {
				code: "invalid_freehand_points",
			},
		});
	});

	it("sets freehand blur points and full-surface bounds", async () => {
		const context = createContext();
		const result = await setBlurFreehandTool(
			{
				id: "annotation-3",
				freehandPoints: [
					{ x: -10, y: 20 },
					{ x: 40, y: 50 },
					{ x: 120, y: 90 },
				],
			},
			context,
		);

		expect(result.structuredContent).toMatchObject({
			success: true,
			id: "annotation-3",
			blurData: {
				shape: "freehand",
				freehandPoints: [
					{ x: 0, y: 20 },
					{ x: 40, y: 50 },
					{ x: 100, y: 90 },
				],
			},
			position: { x: 0, y: 0 },
			size: { width: 100, height: 100 },
			commit: true,
		});
	});

	it("marks preview fullscreen as non-persistent UI state", async () => {
		const context = createContext();
		const result = await setPreviewFullscreenTool({ enabled: true }, context);

		expect(result.structuredContent).toMatchObject({
			success: true,
			enabled: true,
			persisted: false,
		});
		expect(context.send).toHaveBeenCalledWith(
			"editor",
			"preview.fullscreen.set",
			{ enabled: true, persisted: false },
			{ ensureWindow: true, timeoutMs: 10_000 },
		);
	});
});
