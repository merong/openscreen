import { describe, expect, it, vi } from "vitest";
import type { AnnotationToolContext } from "../../electron/mcp/annotationTools";
import {
	addAnnotationTool,
	addCustomFontTool,
	annotationToolDefinitions,
	deleteAnnotationTool,
	duplicateAnnotationTool,
	listAnnotationsTool,
	removeCustomFontTool,
	setAnnotationContentTool,
	setAnnotationFigureTool,
	setAnnotationStyleTool,
	setAnnotationTypeTool,
} from "../../electron/mcp/annotationTools";

function createContext(): AnnotationToolContext & {
	send: ReturnType<typeof vi.fn>;
} {
	const send = vi.fn(async () => ({ accepted: true }));
	return {
		commandBus: { send },
		send,
	};
}

describe("annotation MCP tools", () => {
	it("registers every tool from the annotation editing feature document", () => {
		expect(annotationToolDefinitions.map((tool) => tool.name)).toEqual([
			"openscreen.annotations.list",
			"openscreen.annotations.add",
			"openscreen.annotations.setType",
			"openscreen.annotations.setContent",
			"openscreen.annotations.setStyle",
			"openscreen.annotations.setFigure",
			"openscreen.annotations.duplicate",
			"openscreen.annotations.delete",
			"openscreen.customFonts.list",
			"openscreen.customFonts.add",
			"openscreen.customFonts.remove",
		]);
	});

	it("lists annotations excluding blur regions by default", async () => {
		const context = createContext();
		const result = await listAnnotationsTool({}, context);

		expect(result.structuredContent).toMatchObject({
			success: true,
			includeBlur: false,
		});
		expect(context.send).toHaveBeenCalledWith(
			"editor",
			"annotations.list",
			{ includeBlur: false },
			{ ensureWindow: true, timeoutMs: 10_000 },
		);
	});

	it("adds an annotation with span, style, figure data, and percent bounds", async () => {
		const context = createContext();
		const result = await addAnnotationTool(
			{
				startMs: 100.4,
				endMs: 950.6,
				type: "figure",
				style: {
					fontSize: 32,
					fontWeight: "bold",
					color: "#fff",
					backgroundColor: "transparent",
				},
				figureData: {
					arrowDirection: "down-left",
					color: "#34B27B",
					strokeWidth: 99,
				},
				position: { x: -10, y: 150 },
				size: { width: 0.2, height: 300 },
				commit: false,
			},
			context,
		);

		expect(result.structuredContent).toMatchObject({
			success: true,
			span: { startMs: 100, endMs: 951 },
			annotation: {
				type: "figure",
				style: {
					fontSize: 32,
					fontWeight: "bold",
					color: "#fff",
					backgroundColor: "transparent",
				},
				figureData: {
					arrowDirection: "down-left",
					color: "#34B27B",
					strokeWidth: 6,
				},
				position: { x: 0, y: 100 },
				size: { width: 1, height: 200 },
			},
			commit: false,
		});
		expect(context.send).toHaveBeenCalledWith(
			"editor",
			"annotations.add",
			expect.objectContaining({
				span: { startMs: 100, endMs: 951 },
				annotation: expect.objectContaining({ type: "figure" }),
				commit: false,
			}),
			{ ensureWindow: true, timeoutMs: 10_000 },
		);
	});

	it("rejects blur type because blur annotations are handled by the blur feature document", async () => {
		const context = createContext();
		const result = await setAnnotationTypeTool({ id: "annotation-1", type: "blur" }, context);
		const addResult = await addAnnotationTool({ type: "blur" }, context);

		expect(result.isError).toBe(true);
		expect(addResult.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({
			error: { code: "invalid_annotation_type" },
		});
		expect(addResult.structuredContent).toMatchObject({
			error: { code: "invalid_annotation_type" },
		});
		expect(context.send).not.toHaveBeenCalled();
	});

	it("validates supported image data URL formats", async () => {
		const context = createContext();
		const invalid = await setAnnotationContentTool(
			{
				id: "annotation-1",
				type: "image",
				content: "data:image/svg+xml;base64,PHN2Zy8+",
			},
			context,
		);
		const valid = await setAnnotationContentTool(
			{
				id: "annotation-1",
				type: "image",
				content: "data:image/png;base64,AAAA",
			},
			context,
		);

		expect(invalid.isError).toBe(true);
		expect(valid.structuredContent).toMatchObject({
			success: true,
			id: "annotation-1",
			content: "data:image/png;base64,AAAA",
			type: "image",
		});
		expect(context.send).toHaveBeenCalledTimes(1);
		expect(context.send).toHaveBeenCalledWith(
			"editor",
			"annotations.content.set",
			expect.objectContaining({ id: "annotation-1", type: "image" }),
			{ ensureWindow: true, timeoutMs: 10_000 },
		);
	});

	it("normalizes and validates partial text style edits", async () => {
		const context = createContext();
		const result = await setAnnotationStyleTool(
			{
				annotationId: "annotation-1",
				style: {
					fontSize: 48,
					fontFamily: "Georgia, serif",
					fontWeight: "normal",
					fontStyle: "italic",
					textDecoration: "underline",
					textAlign: "right",
					color: "#123456",
					backgroundColor: "#abc",
				},
			},
			context,
		);
		const invalid = await setAnnotationStyleTool(
			{ id: "annotation-1", style: { fontSize: 13 } },
			createContext(),
		);

		expect(result.structuredContent).toMatchObject({
			success: true,
			id: "annotation-1",
			style: {
				fontSize: 48,
				fontFamily: "Georgia, serif",
				fontWeight: "normal",
				fontStyle: "italic",
				textDecoration: "underline",
				textAlign: "right",
				color: "#123456",
				backgroundColor: "#abc",
			},
		});
		expect(invalid.isError).toBe(true);
		expect(invalid.structuredContent).toMatchObject({
			error: { code: "invalid_annotation_style" },
		});
	});

	it("sets figure data with default values and stroke width clamp", async () => {
		const context = createContext();
		const result = await setAnnotationFigureTool(
			{
				id: "annotation-1",
				arrowDirection: "up-right",
				color: "#fff",
				strokeWidth: 0,
			},
			context,
		);

		expect(result.structuredContent).toMatchObject({
			success: true,
			figureData: {
				arrowDirection: "up-right",
				color: "#fff",
				strokeWidth: 1,
			},
		});
	});

	it("duplicates and deletes annotations by id", async () => {
		const context = createContext();
		await duplicateAnnotationTool({ id: "annotation-1" }, context);
		await deleteAnnotationTool({ annotationId: "annotation-1" }, context);

		expect(context.send).toHaveBeenNthCalledWith(
			1,
			"editor",
			"annotations.duplicate",
			{ id: "annotation-1", offsetPercent: 4 },
			{ ensureWindow: true, timeoutMs: 10_000 },
		);
		expect(context.send).toHaveBeenNthCalledWith(
			2,
			"editor",
			"annotations.delete",
			{ id: "annotation-1" },
			{ ensureWindow: true, timeoutMs: 10_000 },
		);
	});

	it("validates and forwards Google Fonts custom font additions", async () => {
		const context = createContext();
		const invalid = await addCustomFontTool(
			{ importUrl: "https://example.com/css2?family=X" },
			context,
		);
		const valid = await addCustomFontTool(
			{
				id: "roboto-test",
				name: "Roboto Test",
				importUrl: "https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&display=swap",
			},
			context,
		);

		expect(invalid.isError).toBe(true);
		expect(valid.structuredContent).toMatchObject({
			success: true,
			font: {
				id: "roboto-test",
				name: "Roboto Test",
				fontFamily: "Roboto",
				importUrl: "https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&display=swap",
			},
		});
		expect(context.send).toHaveBeenCalledWith(
			"editor",
			"customFonts.add",
			expect.objectContaining({
				font: expect.objectContaining({
					id: "roboto-test",
					fontFamily: "Roboto",
				}),
			}),
			{ ensureWindow: true, timeoutMs: 15_000 },
		);
	});

	it("removes custom fonts by id", async () => {
		const context = createContext();
		const result = await removeCustomFontTool({ fontId: "roboto-test" }, context);

		expect(result.structuredContent).toMatchObject({
			success: true,
			id: "roboto-test",
		});
		expect(context.send).toHaveBeenCalledWith(
			"editor",
			"customFonts.remove",
			{ id: "roboto-test" },
			{ ensureWindow: true, timeoutMs: 10_000 },
		);
	});
});
