import { describe, expect, it, vi } from "vitest";
import type { ProjectMediaToolContext } from "../../electron/mcp/projectMediaTools";
import {
	applyEditorStateTool,
	getCurrentMediaTool,
	projectMediaToolDefinitions,
	saveProjectAsTool,
	saveProjectTool,
	startNewRecordingTool,
} from "../../electron/mcp/projectMediaTools";

function createContext(
	send: ProjectMediaToolContext["commandBus"]["send"] = vi.fn(async () => ({
		accepted: true,
	})),
): ProjectMediaToolContext {
	return {
		commandBus: { send },
		project: {
			startNewRecording: vi.fn(async () => ({ success: true })),
		},
		media: {
			getCurrentRecordingSession: vi.fn(async () => ({
				success: true,
				session: {
					screenVideoPath: "/tmp/screen.webm",
					webcamVideoPath: "/tmp/webcam.webm",
					createdAt: 123,
				},
			})),
		},
	};
}

describe("project/media MCP tools", () => {
	it("registers every tool from the project and media feature document", () => {
		expect(projectMediaToolDefinitions.map((tool) => tool.name)).toEqual([
			"openscreen.project.current",
			"openscreen.project.snapshot",
			"openscreen.project.save",
			"openscreen.project.saveAs",
			"openscreen.project.load",
			"openscreen.project.applyEditorState",
			"openscreen.project.startNewRecording",
			"openscreen.media.current",
		]);
	});

	it("routes save and save-as through distinct editor saveProject modes", async () => {
		const send = vi.fn(async () => ({ saved: true }));
		const context = createContext(send);

		await saveProjectTool({}, context);
		await saveProjectAsTool({}, context);

		expect(send).toHaveBeenNthCalledWith(
			1,
			"editor",
			"project.save",
			{ forceSaveAs: false },
			{ ensureWindow: true, timeoutMs: 60_000 },
		);
		expect(send).toHaveBeenNthCalledWith(
			2,
			"editor",
			"project.save",
			{ forceSaveAs: true },
			{ ensureWindow: true, timeoutMs: 60_000 },
		);
	});

	it("normalizes editor state and optional media before applying it", async () => {
		const send = vi.fn(async () => ({ applied: true }));
		const context = createContext(send);
		const result = await applyEditorStateTool(
			{
				editor: {
					padding: 250,
					aspectRatio: "invalid",
					gifFrameRate: 99,
				},
				media: {
					screenVideoPath: "/tmp/screen.webm",
				},
				source: "test",
			},
			context,
		);

		expect(result.isError).toBeUndefined();
		expect(result.structuredContent).toMatchObject({
			success: true,
			editor: {
				padding: 100,
				aspectRatio: "16:9",
				gifFrameRate: 15,
			},
			media: {
				screenVideoPath: "/tmp/screen.webm",
			},
		});
		expect(send).toHaveBeenCalledWith(
			"editor",
			"project.applyEditorState",
			expect.objectContaining({
				replace: true,
				commit: true,
				source: "test",
				editor: expect.objectContaining({
					padding: 100,
					aspectRatio: "16:9",
				}),
				media: {
					screenVideoPath: "/tmp/screen.webm",
				},
			}),
			{ ensureWindow: true, timeoutMs: 30_000 },
		);
	});

	it("surfaces start-new-recording failures without hiding the main result", async () => {
		const context = createContext();
		context.project.startNewRecording = vi.fn(async () => ({
			success: false,
			error: "blocked",
		}));

		const result = await startNewRecordingTool({}, context);

		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({
			success: false,
			error: {
				code: "start_new_recording_failed",
				details: {
					result: {
						success: false,
						error: "blocked",
					},
				},
			},
		});
	});

	it("falls back to main current recording state when the editor has no media state", async () => {
		const send = vi.fn(async () => {
			throw new Error("editor unavailable");
		});
		const context = createContext(send);
		const result = await getCurrentMediaTool({}, context);

		expect(result.isError).toBeUndefined();
		expect(result.structuredContent).toMatchObject({
			success: true,
			main: {
				success: true,
				session: {
					screenVideoPath: "/tmp/screen.webm",
					webcamVideoPath: "/tmp/webcam.webm",
					createdAt: 123,
				},
			},
		});
		expect(result.structuredContent).toHaveProperty("rendererError");
	});
});
