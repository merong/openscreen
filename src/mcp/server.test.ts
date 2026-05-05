import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { type McpHttpServerController, startMcpServer } from "../../electron/mcp/server";
import type { OpenScreenMcpToolContext } from "../../electron/mcp/tools";

function createTestContext(): OpenScreenMcpToolContext {
	return {
		commandBus: {
			send: async (_target, method, args) => ({
				success: true,
				method,
				args,
			}),
		},
		sources: {
			list: async () => [],
			select: async (source) => source,
			getSelected: () => null,
		},
		media: {
			openVideoFilePicker: async () => ({ success: false, canceled: true }),
			setCurrentVideoPath: async () => ({ success: false, message: "not approved" }),
			getCurrentRecordingSession: () => ({ success: false }),
			getCursorTelemetry: () => ({ success: true, samples: [], clicks: [] }),
		},
		project: {
			loadProjectFile: async () => ({ success: false, canceled: true }),
			startNewRecording: () => ({ success: true }),
		},
		windows: {
			switchToEditor: () => undefined,
		},
		locale: {
			setMainLocale: () => undefined,
		},
		platform: {
			isMac: false,
			name: "linux",
		},
		permissions: {
			requestAccessibilityAccess: () => ({ success: true, granted: true }),
		},
		files: {
			revealInFolder: () => ({ success: true }),
		},
		shortcuts: {
			getShortcuts: () => null,
			saveShortcuts: () => ({ success: true }),
		},
	};
}

describe("startMcpServer", () => {
	let controller: McpHttpServerController | null = null;
	let client: Client | null = null;

	afterEach(async () => {
		await client?.close();
		client = null;
		await controller?.close();
		controller = null;
	});

	it("serves tools and resources over Streamable HTTP", async () => {
		controller = await startMcpServer({
			host: "127.0.0.1",
			port: 0,
			path: "/mcp",
			context: createTestContext(),
			appVersion: "test",
			resources: [
				{
					uri: "openscreen://test",
					name: "test",
					description: "Test resource",
					mimeType: "application/json",
					read: async () => ({ success: true }),
				},
			],
		});

		client = new Client({ name: "openscreen-test", version: "test" });
		await client.connect(new StreamableHTTPClientTransport(new URL(controller.url)));

		const tools = await client.listTools();
		expect(tools.tools.some((tool) => tool.name === "openscreen.sources.list")).toBe(true);

		const resources = await client.listResources();
		expect(resources.resources).toHaveLength(1);

		const resource = await client.readResource({ uri: "openscreen://test" });
		expect(resource.contents[0]).toMatchObject({
			uri: "openscreen://test",
			mimeType: "application/json",
			text: JSON.stringify({ success: true }, null, 2),
		});
	});

	it("serves markdown resources as plain text", async () => {
		controller = await startMcpServer({
			host: "127.0.0.1",
			port: 0,
			path: "/mcp",
			context: createTestContext(),
			appVersion: "test",
			resources: [
				{
					uri: "openscreen://editing/guide",
					name: "mcp-editing-guide",
					description: "Editing guide",
					mimeType: "text/markdown",
					read: async () => "# Editing Guide\n\nUse this before mutating tools.",
				},
			],
		});

		client = new Client({ name: "openscreen-test", version: "test" });
		await client.connect(new StreamableHTTPClientTransport(new URL(controller.url)));

		const resource = await client.readResource({ uri: "openscreen://editing/guide" });
		expect(resource.contents[0]).toMatchObject({
			uri: "openscreen://editing/guide",
			mimeType: "text/markdown",
			text: "# Editing Guide\n\nUse this before mutating tools.",
		});
	});
});
