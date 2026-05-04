import { describe, expect, it, vi } from "vitest";
import type { TimelineToolContext } from "../../electron/mcp/timelineTools";
import {
	addKeyframeTool,
	addSpeedRegionTool,
	addZoomRegionTool,
	deleteKeyframeTool,
	deleteTrimRegionTool,
	seekTimelineTool,
	setTimelineRangeTool,
	timelineToolDefinitions,
	updateZoomRegionTool,
} from "../../electron/mcp/timelineTools";

function createContext(): TimelineToolContext & {
	send: ReturnType<typeof vi.fn>;
} {
	const send = vi.fn(async () => ({ accepted: true }));
	return {
		commandBus: { send },
		send,
	};
}

describe("timeline MCP tools", () => {
	it("registers every tool from the timeline feature document", () => {
		expect(timelineToolDefinitions.map((tool) => tool.name)).toEqual([
			"openscreen.timeline.state",
			"openscreen.timeline.seek",
			"openscreen.timeline.range.set",
			"openscreen.timeline.zoom.add",
			"openscreen.timeline.zoom.suggest",
			"openscreen.timeline.zoom.update",
			"openscreen.timeline.zoom.delete",
			"openscreen.timeline.trim.add",
			"openscreen.timeline.trim.update",
			"openscreen.timeline.trim.delete",
			"openscreen.timeline.speed.add",
			"openscreen.timeline.speed.update",
			"openscreen.timeline.speed.delete",
			"openscreen.timeline.annotation.add",
			"openscreen.timeline.annotation.update",
			"openscreen.timeline.annotation.delete",
			"openscreen.timeline.blur.add",
			"openscreen.timeline.blur.update",
			"openscreen.timeline.blur.delete",
			"openscreen.timeline.keyframe.list",
			"openscreen.timeline.keyframe.add",
			"openscreen.timeline.keyframe.update",
			"openscreen.timeline.keyframe.delete",
		]);
	});

	it("seeks using clamped milliseconds and marks the command as non-persistent", async () => {
		const context = createContext();
		const result = await seekTimelineTool({ seconds: 2, durationMs: 1500 }, context);

		expect(result.structuredContent).toMatchObject({
			success: true,
			timeMs: 1500,
			persisted: false,
		});
		expect(context.send).toHaveBeenCalledWith(
			"editor",
			"timeline.seek",
			{ timeMs: 1500, persisted: false },
			{ ensureWindow: true, timeoutMs: 10_000 },
		);
	});

	it("normalizes short spans and clamps custom speed before adding a speed region", async () => {
		const context = createContext();
		const result = await addSpeedRegionTool(
			{ startMs: 100, endMs: 120, durationMs: 1000, speed: 99 },
			context,
		);

		expect(result.structuredContent).toMatchObject({
			success: true,
			kind: "speed",
			span: {
				startMs: 100,
				endMs: 200,
				durationMs: 1000,
			},
			speed: 16,
		});
		expect(context.send).toHaveBeenCalledWith(
			"editor",
			"timeline.speed.add",
			{
				span: {
					startMs: 100,
					endMs: 200,
					durationMs: 1000,
				},
				speed: 16,
			},
			{ ensureWindow: true, timeoutMs: 10_000 },
		);
	});

	it("lets add-region commands fall back to the renderer current time", async () => {
		const context = createContext();
		const result = await addZoomRegionTool({}, context);

		expect(result.structuredContent).toMatchObject({
			success: true,
			kind: "zoom",
			useCurrentTime: true,
		});
		expect(context.send).toHaveBeenCalledWith(
			"editor",
			"timeline.zoom.add",
			expect.objectContaining({ useCurrentTime: true }),
			{ ensureWindow: true, timeoutMs: 10_000 },
		);
	});

	it("normalizes zoom update options before dispatch", async () => {
		const context = createContext();
		const result = await updateZoomRegionTool(
			{
				id: "zoom-1",
				startMs: 0,
				endMs: 40,
				durationMs: 2000,
				depth: 99,
				focus: { cx: 2, cy: -1 },
				focusMode: "auto",
				rotationPreset: "left",
			},
			context,
		);

		expect(result.structuredContent).toMatchObject({
			success: true,
			kind: "zoom",
			id: "zoom-1",
			span: {
				startMs: 0,
				endMs: 100,
				durationMs: 2000,
			},
			depth: 6,
			focus: { cx: 1, cy: 0 },
			focusMode: "auto",
			rotationPreset: "left",
		});
	});

	it("rejects region deletes without an id", async () => {
		const context = createContext();
		const result = await deleteTrimRegionTool({}, context);

		expect(result.isError).toBe(true);
		expect(context.send).not.toHaveBeenCalled();
		expect(result.structuredContent).toMatchObject({
			success: false,
			error: {
				code: "missing_id",
			},
		});
	});

	it("normalizes temporary keyframe commands as non-persistent timeline state", async () => {
		const context = createContext();
		await addKeyframeTool({ currentTimeMs: 2300, durationMs: 2000 }, context);
		const deleteResult = await deleteKeyframeTool({}, context);

		expect(context.send).toHaveBeenNthCalledWith(
			1,
			"editor",
			"timeline.keyframe.add",
			{ timeMs: 2000, persisted: false },
			{ ensureWindow: true, timeoutMs: 10_000 },
		);
		expect(deleteResult.structuredContent).toMatchObject({
			success: true,
			selected: true,
			persisted: false,
		});
	});

	it("sets the temporary timeline viewport range", async () => {
		const context = createContext();
		const result = await setTimelineRangeTool({ startMs: 500, endMs: 1500 }, context);

		expect(result.structuredContent).toMatchObject({
			success: true,
			range: { startMs: 500, endMs: 1500 },
			persisted: false,
		});
	});
});
