import { describe, expect, it, vi } from "vitest";
import type { BlurToolContext } from "../../electron/mcp/blurTools";
import {
	addBlurTool,
	blurToolDefinitions,
	deleteBlurTool,
	listBlursTool,
	previewBlurDataTool,
	setBlurBoundsTool,
	setBlurDataTool,
} from "../../electron/mcp/blurTools";

function createContext(): BlurToolContext & {
	send: ReturnType<typeof vi.fn>;
} {
	const send = vi.fn(async () => ({ accepted: true }));
	return {
		commandBus: { send },
		send,
	};
}

describe("blur/mosaic MCP tools", () => {
	it("registers every tool from the blur and mosaic feature document", () => {
		expect(blurToolDefinitions.map((tool) => tool.name)).toEqual([
			"openscreen.blurs.list",
			"openscreen.blurs.add",
			"openscreen.blurs.setData",
			"openscreen.blurs.previewData",
			"openscreen.blurs.setBounds",
			"openscreen.blurs.delete",
		]);
	});

	it("lists blur annotation regions only", async () => {
		const context = createContext();
		const result = await listBlursTool({}, context);

		expect(result.structuredContent).toMatchObject({ success: true });
		expect(context.send).toHaveBeenCalledWith(
			"editor",
			"blurs.list",
			{},
			{ ensureWindow: true, timeoutMs: 10_000 },
		);
	});

	it("adds mosaic blur with normalized span, data, and percent bounds", async () => {
		const context = createContext();
		const result = await addBlurTool(
			{
				startMs: 120.3,
				endMs: 50,
				type: "mosaic",
				shape: "oval",
				color: "black",
				intensity: 100,
				blockSize: 99,
				position: { x: -20, y: 120 },
				size: { width: 0.1, height: 250 },
				commit: false,
			},
			context,
		);

		expect(result.structuredContent).toMatchObject({
			success: true,
			span: { startMs: 120, endMs: 121 },
			blurData: {
				type: "mosaic",
				shape: "oval",
				color: "black",
				intensity: 40,
				blockSize: 48,
			},
			activeControl: {
				valueKind: "blockSize",
				value: 48,
				range: { min: 4, max: 48 },
			},
			position: { x: 0, y: 100 },
			size: { width: 1, height: 200 },
			boundsForcedForFreehand: false,
			commit: false,
		});
		expect(context.send).toHaveBeenCalledWith(
			"editor",
			"blurs.add",
			expect.objectContaining({
				span: { startMs: 120, endMs: 121 },
				blurData: expect.objectContaining({ type: "mosaic", blockSize: 48 }),
				position: { x: 0, y: 100 },
				size: { width: 1, height: 200 },
				commit: false,
			}),
			{ ensureWindow: true, timeoutMs: 10_000 },
		);
	});

	it("rejects unsupported blur data instead of sending a renderer mutation", async () => {
		const context = createContext();
		const badType = await setBlurDataTool({ id: "annotation-1", type: "pixelate" }, context);
		const badShape = await setBlurDataTool({ id: "annotation-1", shape: "circle" }, context);
		const badColor = await setBlurDataTool({ id: "annotation-1", color: "red" }, context);
		const badPointsShape = await setBlurDataTool(
			{
				id: "annotation-1",
				shape: "rectangle",
				freehandPoints: [
					{ x: 0, y: 0 },
					{ x: 10, y: 10 },
					{ x: 20, y: 20 },
				],
			},
			context,
		);

		expect(badType.isError).toBe(true);
		expect(badShape.isError).toBe(true);
		expect(badColor.isError).toBe(true);
		expect(badPointsShape.isError).toBe(true);
		expect(context.send).not.toHaveBeenCalled();
	});

	it("previews freehand blur data without committing by default and forces full-surface bounds", async () => {
		const context = createContext();
		const invalid = await previewBlurDataTool(
			{
				id: "annotation-1",
				shape: "freehand",
				freehandPoints: [
					{ x: 0, y: 0 },
					{ x: 50, y: 50 },
				],
			},
			context,
		);
		const result = await previewBlurDataTool(
			{
				id: "annotation-1",
				shape: "freehand",
				points: [
					{ x: -10, y: 5 },
					{ x: 50, y: 50 },
					{ x: 110, y: 95 },
				],
			},
			context,
		);

		expect(invalid.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({
			success: true,
			id: "annotation-1",
			blurData: {
				type: "blur",
				shape: "freehand",
				freehandPoints: [
					{ x: 0, y: 5 },
					{ x: 50, y: 50 },
					{ x: 100, y: 95 },
				],
			},
			position: { x: 0, y: 0 },
			size: { width: 100, height: 100 },
			boundsForcedForFreehand: true,
			commit: false,
		});
		expect(context.send).toHaveBeenCalledTimes(1);
		expect(context.send).toHaveBeenCalledWith(
			"editor",
			"blurs.data.preview",
			expect.objectContaining({
				id: "annotation-1",
				position: { x: 0, y: 0 },
				size: { width: 100, height: 100 },
				commit: false,
			}),
			{ ensureWindow: true, timeoutMs: 10_000 },
		);
	});

	it("sets blur data with commit by default and reports the intensity control for blur type", async () => {
		const context = createContext();
		const result = await setBlurDataTool(
			{
				regionId: "annotation-1",
				blurData: {
					type: "blur",
					shape: "rectangle",
					color: "white",
					intensity: 1,
					blockSize: 1,
				},
			},
			context,
		);

		expect(result.structuredContent).toMatchObject({
			success: true,
			id: "annotation-1",
			blurData: {
				type: "blur",
				shape: "rectangle",
				color: "white",
				intensity: 2,
				blockSize: 4,
			},
			activeControl: {
				valueKind: "intensity",
				value: 2,
				range: { min: 2, max: 40 },
			},
			commit: true,
		});
		expect(context.send).toHaveBeenCalledWith(
			"editor",
			"blurs.data.set",
			expect.objectContaining({
				id: "annotation-1",
				blurData: expect.objectContaining({ intensity: 2, blockSize: 4 }),
				commit: true,
			}),
			{ ensureWindow: true, timeoutMs: 10_000 },
		);
	});

	it("sets rectangle/oval blur bounds in percent coordinates", async () => {
		const context = createContext();
		const result = await setBlurBoundsTool(
			{
				id: "annotation-1",
				currentShape: "oval",
				x: 10,
				y: -5,
				width: 300,
				height: 0,
			},
			context,
		);

		expect(result.structuredContent).toMatchObject({
			success: true,
			id: "annotation-1",
			position: { x: 10, y: 0 },
			size: { width: 200, height: 1 },
			boundsForcedForFreehand: false,
		});
	});

	it("forces full-surface bounds for freehand blur", async () => {
		const context = createContext();
		const result = await setBlurBoundsTool(
			{
				id: "annotation-1",
				currentShape: "freehand",
			},
			context,
		);

		expect(result.structuredContent).toMatchObject({
			success: true,
			id: "annotation-1",
			position: { x: 0, y: 0 },
			size: { width: 100, height: 100 },
			boundsForcedForFreehand: true,
		});
		expect(context.send).toHaveBeenCalledWith(
			"editor",
			"blurs.bounds.set",
			expect.objectContaining({
				id: "annotation-1",
				position: { x: 0, y: 0 },
				size: { width: 100, height: 100 },
			}),
			{ ensureWindow: true, timeoutMs: 10_000 },
		);
	});

	it("deletes a blur annotation by id", async () => {
		const context = createContext();
		const result = await deleteBlurTool({ regionId: "annotation-1" }, context);

		expect(result.structuredContent).toMatchObject({
			success: true,
			id: "annotation-1",
		});
		expect(context.send).toHaveBeenCalledWith(
			"editor",
			"blurs.delete",
			{ id: "annotation-1" },
			{ ensureWindow: true, timeoutMs: 10_000 },
		);
	});
});
