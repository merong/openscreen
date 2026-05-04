import { describe, expect, it, vi } from "vitest";
import type { RecordingHudToolContext } from "../../electron/mcp/recordingHudTools";
import {
	openVideoTool,
	recordingHudToolDefinitions,
	selectSourceTool,
	setLocaleTool,
	startRecordingTool,
} from "../../electron/mcp/recordingHudTools";
import type { ProcessedDesktopSource } from "../../electron/mcp/toolTypes";

const source: ProcessedDesktopSource = {
	id: "screen:1:0",
	name: "Screen 1",
	display_id: "1",
	thumbnail: null,
	appIcon: null,
};

function createContext(selectedSource: ProcessedDesktopSource | null): RecordingHudToolContext {
	const send = vi.fn(async () => ({ accepted: true }));
	const select = vi.fn(async (nextSource: ProcessedDesktopSource) => nextSource);
	const setCurrentVideoPath = vi.fn(async () => ({ success: true }));
	const switchToEditor = vi.fn(async () => undefined);

	return {
		commandBus: { send },
		sources: {
			list: vi.fn(async () => [source]),
			select,
			getSelected: vi.fn(async () => selectedSource),
		},
		media: {
			openVideoFilePicker: vi.fn(async () => ({ success: true, path: "/tmp/video.mp4" })),
			setCurrentVideoPath,
		},
		project: {
			loadProjectFile: vi.fn(async () => ({
				success: true,
				path: "/tmp/project.openscreen",
				project: {},
			})),
		},
		windows: { switchToEditor },
		locale: {
			setMainLocale: vi.fn(async () => undefined),
		},
	};
}

describe("recording HUD MCP tools", () => {
	it("registers every tool from the recording HUD feature document", () => {
		expect(recordingHudToolDefinitions.map((tool) => tool.name)).toEqual([
			"openscreen.sources.list",
			"openscreen.sources.select",
			"openscreen.recording.options.set",
			"openscreen.recording.start",
			"openscreen.recording.stop",
			"openscreen.recording.pause",
			"openscreen.recording.resume",
			"openscreen.recording.restart",
			"openscreen.recording.cancel",
			"openscreen.media.openVideo",
			"openscreen.project.openFromHud",
			"openscreen.locale.set",
		]);
	});

	it("selects a source by id through the shared source context", async () => {
		const context = createContext(null);
		const result = await selectSourceTool({ sourceId: source.id }, context);

		expect(result.isError).toBeUndefined();
		expect(context.sources.select).toHaveBeenCalledWith(source);
		expect(result.structuredContent).toMatchObject({
			success: true,
			selectedSource: source,
		});
	});

	it("rejects recording start until a source is selected", async () => {
		const context = createContext(null);
		const result = await startRecordingTool({}, context);

		expect(result.isError).toBe(true);
		expect(context.commandBus.send).not.toHaveBeenCalled();
		expect(result.structuredContent).toMatchObject({
			success: false,
			error: {
				code: "source_required",
			},
		});
	});

	it("rejects unsupported direct video paths before switching windows", async () => {
		const context = createContext(source);
		const result = await openVideoTool({ path: "/tmp/not-video.txt" }, context);

		expect(result.isError).toBe(true);
		expect(context.media.setCurrentVideoPath).not.toHaveBeenCalled();
		expect(context.windows.switchToEditor).not.toHaveBeenCalled();
		expect(result.structuredContent).toMatchObject({
			success: false,
			error: {
				code: "unsupported_video_type",
			},
		});
	});

	it("sets supported locales through the HUD command bus and main locale hook", async () => {
		const context = createContext(source);
		const result = await setLocaleTool({ locale: "ko-KR" }, context);

		expect(result.isError).toBeUndefined();
		expect(context.commandBus.send).toHaveBeenCalledWith(
			"hud",
			"locale.set",
			{ locale: "ko-KR" },
			{ ensureWindow: true, timeoutMs: 10_000 },
		);
		expect(context.locale?.setMainLocale).toHaveBeenCalledWith("ko-KR");
	});
});
