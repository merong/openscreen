import { describe, expect, it, vi } from "vitest";
import type { CursorHighlightToolContext } from "../../electron/mcp/cursorHighlightTools";
import {
	cursorHighlightToolDefinitions,
	getCursorTelemetryTool,
	patchCursorHighlightTool,
	requestCursorClickPermissionTool,
	setCursorHighlightTool,
} from "../../electron/mcp/cursorHighlightTools";

function createContext(
	overrides: Partial<CursorHighlightToolContext> = {},
): CursorHighlightToolContext & {
	send: ReturnType<typeof vi.fn>;
	getCursorTelemetry: ReturnType<typeof vi.fn>;
	requestAccessibilityAccess: ReturnType<typeof vi.fn>;
} {
	const send = vi.fn(async () => ({ accepted: true }));
	const getCursorTelemetry = vi.fn(async () => ({
		success: true,
		samples: [
			{ timeMs: 100, cx: 0.2, cy: 0.3 },
			{ timeMs: 200, cx: 0.4, cy: 0.5 },
		],
		clicks: [150],
	}));
	const requestAccessibilityAccess = vi.fn(async () => ({
		success: true,
		granted: false,
		status: "prompted",
	}));

	return {
		commandBus: { send },
		platform: "darwin",
		media: { getCursorTelemetry },
		permissions: { requestAccessibilityAccess },
		...overrides,
		send,
		getCursorTelemetry,
		requestAccessibilityAccess,
	};
}

describe("cursor highlight MCP tools", () => {
	it("registers every tool from the cursor highlight feature document", () => {
		expect(cursorHighlightToolDefinitions.map((tool) => tool.name)).toEqual([
			"openscreen.cursorTelemetry.get",
			"openscreen.cursorHighlight.get",
			"openscreen.cursorHighlight.set",
			"openscreen.cursorHighlight.patch",
			"openscreen.cursorHighlight.requestClickPermission",
		]);
	});

	it("summarizes cursor telemetry without returning samples by default", async () => {
		const context = createContext();
		const result = await getCursorTelemetryTool({ videoPath: "/tmp/video.webm" }, context);

		expect(context.getCursorTelemetry).toHaveBeenCalledWith("/tmp/video.webm");
		expect(result.structuredContent).toMatchObject({
			success: true,
			hasCursorTelemetry: true,
			sampleCount: 2,
			clickCount: 1,
			videoPath: "/tmp/video.webm",
		});
		expect(result.structuredContent).not.toHaveProperty("samples");
	});

	it("can include cursor telemetry samples and clicks for callers that need them", async () => {
		const context = createContext();
		const result = await getCursorTelemetryTool({ includeSamples: true }, context);

		expect(result.structuredContent).toMatchObject({
			samples: [
				{ timeMs: 100, cx: 0.2, cy: 0.3 },
				{ timeMs: 200, cx: 0.4, cy: 0.5 },
			],
			clicks: [150],
		});
	});

	it("sets full config with UI offset range and non-mac effective click-only disabled", async () => {
		const context = createContext({ platform: "linux" });
		const result = await setCursorHighlightTool(
			{
				cursorHighlight: {
					enabled: true,
					style: "dot",
					sizePx: 99,
					color: "#abc",
					opacity: 2,
					onlyOnClicks: true,
					clickEmphasisDurationMs: -20,
					offsetXNorm: 0.8,
					offsetYNorm: -0.8,
				},
				commit: false,
			},
			context,
		);

		expect(result.structuredContent).toMatchObject({
			success: true,
			cursorHighlight: {
				enabled: true,
				style: "dot",
				sizePx: 36,
				color: "#abc",
				opacity: 1,
				onlyOnClicks: true,
				clickEmphasisDurationMs: 1,
				offsetXNorm: 0.25,
				offsetYNorm: -0.25,
			},
			effectiveCursorHighlight: {
				onlyOnClicks: false,
			},
			clickOnlyRenderEffective: false,
			commit: false,
		});
		expect(context.requestAccessibilityAccess).not.toHaveBeenCalled();
		expect(context.send).toHaveBeenCalledWith(
			"editor",
			"cursorHighlight.set",
			expect.objectContaining({
				cursorHighlight: expect.objectContaining({ onlyOnClicks: true }),
				effectiveCursorHighlight: expect.objectContaining({ onlyOnClicks: false }),
				commit: false,
			}),
			{ ensureWindow: true, timeoutMs: 10_000 },
		);
	});

	it("uses extended offset range only when explicitly requested", async () => {
		const context = createContext();
		const result = await patchCursorHighlightTool(
			{
				patch: {
					offsetXNorm: 0.8,
					offsetYNorm: -0.8,
				},
				allowExtendedOffsetRange: true,
			},
			context,
		);

		expect(result.structuredContent).toMatchObject({
			success: true,
			patch: {
				offsetXNorm: 0.8,
				offsetYNorm: -0.8,
			},
			offsetRange: 1,
		});
	});

	it("requests accessibility permission when enabling click-only on macOS", async () => {
		const context = createContext();
		const result = await patchCursorHighlightTool({ onlyOnClicks: true }, context);

		expect(context.requestAccessibilityAccess).toHaveBeenCalled();
		expect(result.structuredContent).toMatchObject({
			success: true,
			patch: { onlyOnClicks: true },
			supportsClickTelemetry: true,
			clickOnlyRenderEffective: true,
			permission: {
				success: true,
				granted: false,
				status: "prompted",
				needsUserAction: true,
			},
		});
	});

	it("rejects invalid style and color instead of sending a renderer mutation", async () => {
		const context = createContext();
		const styleResult = await patchCursorHighlightTool({ style: "box" }, context);
		const colorResult = await setCursorHighlightTool({ color: "gold" }, context);

		expect(styleResult.isError).toBe(true);
		expect(colorResult.isError).toBe(true);
		expect(context.send).not.toHaveBeenCalled();
	});

	it("reports non-mac click permission as not platform-gated", async () => {
		const context = createContext({ platform: "win32" });
		const result = await requestCursorClickPermissionTool({}, context);

		expect(context.requestAccessibilityAccess).not.toHaveBeenCalled();
		expect(result.structuredContent).toMatchObject({
			success: true,
			granted: true,
			supportsClickTelemetry: false,
			needsUserAction: false,
		});
	});
});
