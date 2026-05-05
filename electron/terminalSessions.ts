import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { app, type IpcMainEvent, type IpcMainInvokeEvent, ipcMain } from "electron";
import type { IDisposable, IPty } from "node-pty";

type TerminalLaunchMode = "shell";

type TerminalSession = {
	id: string;
	ownerWebContentsId: number;
	pty: IPty;
	dataDisposable: IDisposable;
	exitDisposable: IDisposable;
};

type TerminalCreateInput = {
	sessionId?: unknown;
	cols?: unknown;
	rows?: unknown;
	mode?: unknown;
};

type TerminalWriteInput = {
	sessionId?: unknown;
	data?: unknown;
};

type TerminalResizeInput = {
	sessionId?: unknown;
	cols?: unknown;
	rows?: unknown;
};

type TerminalKillInput = {
	sessionId?: unknown;
};

type McpClientConfigWriteResult = {
	success: boolean;
	path: string;
	snippet: string;
	manualCommands: string[];
	error?: string;
};

type McpClientConfigInfo = {
	projectRoot: string;
	serverName: string;
	endpoint: string;
	authRequired: boolean;
	tokenEnvVar: string;
	codex: McpClientConfigWriteResult;
	claude: McpClientConfigWriteResult;
};

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const MAX_COLS = 500;
const MAX_ROWS = 200;
const MCP_SERVER_NAME = "openscreen";
const MCP_SERVER_URL = "http://127.0.0.1:18888/mcp";
const MCP_TOKEN_ENV_VAR = "OPENSCREEN_MCP_TOKEN";
const require = createRequire(import.meta.url);
let nodePty: typeof import("node-pty") | null = null;

function getNodePty() {
	nodePty ??= require("node-pty") as typeof import("node-pty");
	return nodePty;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number) {
	return typeof value === "number" && Number.isFinite(value)
		? Math.max(min, Math.min(max, Math.floor(value)))
		: fallback;
}

function isValidSessionId(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length >= 8 &&
		value.length <= 128 &&
		/^[a-zA-Z0-9_.:-]+$/.test(value)
	);
}

function getTerminalCwd() {
	return app.isPackaged ? os.homedir() : process.cwd();
}

function isMcpAuthRequired() {
	return (
		Boolean(process.env[MCP_TOKEN_ENV_VAR]?.trim()) &&
		process.env["OPENSCREEN_MCP_DISABLE_AUTH"] !== "true"
	);
}

function tomlString(value: string) {
	return JSON.stringify(value);
}

function getCodexSnippet(authRequired: boolean) {
	const lines = [
		`[mcp_servers.${MCP_SERVER_NAME}]`,
		`url = ${tomlString(MCP_SERVER_URL)}`,
		...(authRequired ? [`bearer_token_env_var = ${tomlString(MCP_TOKEN_ENV_VAR)}`] : []),
	];
	return `${lines.join("\n")}\n`;
}

function removeTomlTable(source: string, tableName: string) {
	const lines = source.split(/\r?\n/);
	const result: string[] = [];
	let skipping = false;

	for (const line of lines) {
		const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
		if (header) {
			skipping = header[1] === tableName;
			if (skipping) continue;
		}
		if (!skipping) {
			result.push(line);
		}
	}

	return result.join("\n").trimEnd();
}

async function writeCodexProjectConfig(
	projectRoot: string,
	authRequired: boolean,
): Promise<McpClientConfigWriteResult> {
	const codexHome = path.join(projectRoot, ".codex");
	const configPath = path.join(codexHome, "config.toml");
	const snippet = getCodexSnippet(authRequired);
	const manualCommands = [
		"mkdir -p .codex",
		`CODEX_HOME="$PWD/.codex" codex mcp add ${MCP_SERVER_NAME} --url ${MCP_SERVER_URL}${
			authRequired ? ` --bearer-token-env-var ${MCP_TOKEN_ENV_VAR}` : ""
		}`,
		'CODEX_HOME="$PWD/.codex" codex',
	];

	try {
		await fs.mkdir(codexHome, { recursive: true });
		let existing = "";
		try {
			existing = await fs.readFile(configPath, "utf-8");
		} catch (error) {
			const nodeError = error as NodeJS.ErrnoException;
			if (nodeError.code !== "ENOENT") throw error;
		}

		const nextBase = removeTomlTable(existing, `mcp_servers.${MCP_SERVER_NAME}`);
		const next = nextBase ? `${nextBase}\n\n${snippet}` : snippet;
		await fs.writeFile(configPath, next, "utf-8");
		return {
			success: true,
			path: configPath,
			snippet,
			manualCommands,
		};
	} catch (error) {
		return {
			success: false,
			path: configPath,
			snippet,
			manualCommands,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

function getClaudeServerConfig(authRequired: boolean) {
	return {
		type: "http",
		url: MCP_SERVER_URL,
		...(authRequired
			? {
					headers: {
						Authorization: `Bearer \${${MCP_TOKEN_ENV_VAR}}`,
					},
				}
			: {}),
	};
}

async function writeClaudeProjectConfig(
	projectRoot: string,
	authRequired: boolean,
): Promise<McpClientConfigWriteResult> {
	const configPath = path.join(projectRoot, ".mcp.json");
	const serverConfig = getClaudeServerConfig(authRequired);
	const snippet = JSON.stringify(
		{
			mcpServers: {
				[MCP_SERVER_NAME]: serverConfig,
			},
		},
		null,
		2,
	);
	const manualCommands = [
		`claude mcp add --scope project --transport http ${MCP_SERVER_NAME} ${MCP_SERVER_URL}${
			authRequired ? ` --header 'Authorization: Bearer \${${MCP_TOKEN_ENV_VAR}}'` : ""
		}`,
		"claude",
	];

	try {
		let existing: Record<string, unknown> = {};
		try {
			existing = JSON.parse(await fs.readFile(configPath, "utf-8")) as Record<string, unknown>;
		} catch (error) {
			const nodeError = error as NodeJS.ErrnoException;
			if (nodeError.code === "ENOENT") {
				existing = {};
			} else {
				throw error;
			}
		}

		if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
			existing = {};
		}
		const existingServers =
			existing.mcpServers &&
			typeof existing.mcpServers === "object" &&
			!Array.isArray(existing.mcpServers)
				? existing.mcpServers
				: {};

		const next = {
			...existing,
			mcpServers: {
				...existingServers,
				[MCP_SERVER_NAME]: serverConfig,
			},
		};
		await fs.writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
		return {
			success: true,
			path: configPath,
			snippet,
			manualCommands,
		};
	} catch (error) {
		return {
			success: false,
			path: configPath,
			snippet,
			manualCommands,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

async function ensureProjectMcpClientConfigs(projectRoot: string): Promise<McpClientConfigInfo> {
	const authRequired = isMcpAuthRequired();
	const [codex, claude] = await Promise.all([
		writeCodexProjectConfig(projectRoot, authRequired),
		writeClaudeProjectConfig(projectRoot, authRequired),
	]);

	return {
		projectRoot,
		serverName: MCP_SERVER_NAME,
		endpoint: MCP_SERVER_URL,
		authRequired,
		tokenEnvVar: MCP_TOKEN_ENV_VAR,
		codex,
		claude,
	};
}

function getShellConfig() {
	if (process.platform === "win32") {
		const shell = process.env["COMSPEC"] || "powershell.exe";
		const basename = path.basename(shell).toLowerCase();
		return {
			shell,
			args: basename.includes("powershell") ? ["-NoLogo"] : [],
		};
	}

	const shell = process.env["SHELL"] || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");
	return {
		shell,
		args: ["-l"],
	};
}

function buildTerminalEnv(projectRoot: string) {
	return {
		...process.env,
		COLORTERM: "truecolor",
		CODEX_HOME: path.join(projectRoot, ".codex"),
		FORCE_COLOR: "1",
		TERM: "xterm-256color",
	};
}

function sendTerminalError(
	event: IpcMainEvent | IpcMainInvokeEvent,
	sessionId: string,
	error: string,
) {
	event.sender.send("terminal:data", {
		sessionId,
		data: `\r\n\x1b[31m${error}\x1b[0m\r\n`,
	});
	event.sender.send("terminal:exit", {
		sessionId,
		exitCode: 1,
	});
}

export function registerTerminalSessionIpcHandlers() {
	const sessions = new Map<string, TerminalSession>();

	const disposeSession = (sessionId: string) => {
		const session = sessions.get(sessionId);
		if (!session) return;
		sessions.delete(sessionId);
		session.dataDisposable.dispose();
		session.exitDisposable.dispose();
		try {
			session.pty.kill();
		} catch {
			// Process may already be gone.
		}
	};

	const assertOwnerSession = (event: IpcMainEvent | IpcMainInvokeEvent, sessionId: unknown) => {
		if (!isValidSessionId(sessionId)) return null;
		const session = sessions.get(sessionId);
		if (!session || session.ownerWebContentsId !== event.sender.id) return null;
		return session;
	};

	ipcMain.handle("mcp-client-config:get", async () => {
		return ensureProjectMcpClientConfigs(getTerminalCwd());
	});

	ipcMain.handle("terminal:create", async (event, input: TerminalCreateInput = {}) => {
		if (!isValidSessionId(input.sessionId)) {
			return {
				success: false,
				error: "Invalid terminal session id.",
			};
		}

		if (sessions.has(input.sessionId)) {
			return {
				success: true,
				sessionId: input.sessionId,
			};
		}

		const sessionId = input.sessionId;
		const mode: TerminalLaunchMode = input.mode === "shell" ? "shell" : "shell";
		const cols = clampInteger(input.cols, DEFAULT_COLS, 20, MAX_COLS);
		const rows = clampInteger(input.rows, DEFAULT_ROWS, 5, MAX_ROWS);
		const { shell, args } = getShellConfig();
		const cwd = getTerminalCwd();
		const mcpClientConfig = await ensureProjectMcpClientConfigs(cwd);

		try {
			const terminalProcess = getNodePty().spawn(shell, args, {
				name: "xterm-256color",
				cols,
				rows,
				cwd,
				env: buildTerminalEnv(cwd),
			});
			const dataDisposable = terminalProcess.onData((data) => {
				if (!event.sender.isDestroyed()) {
					event.sender.send("terminal:data", {
						sessionId,
						data,
					});
				}
			});
			const exitDisposable = terminalProcess.onExit(({ exitCode, signal }) => {
				sessions.delete(sessionId);
				if (!event.sender.isDestroyed()) {
					event.sender.send("terminal:exit", {
						sessionId,
						exitCode,
						signal,
					});
				}
			});

			sessions.set(sessionId, {
				id: sessionId,
				ownerWebContentsId: event.sender.id,
				pty: terminalProcess,
				dataDisposable,
				exitDisposable,
			});
			event.sender.once("destroyed", () => disposeSession(sessionId));

			return {
				success: true,
				sessionId,
				pid: terminalProcess.pid,
				mode,
				cwd,
				shell,
				mcpClientConfig,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			sendTerminalError(event, sessionId, `Failed to start terminal: ${message}`);
			return {
				success: false,
				error: message,
			};
		}
	});

	ipcMain.on("terminal:write", (event, input: TerminalWriteInput = {}) => {
		const session = assertOwnerSession(event, input.sessionId);
		if (!session || typeof input.data !== "string") return;
		session.pty.write(input.data);
	});

	ipcMain.on("terminal:resize", (event, input: TerminalResizeInput = {}) => {
		const session = assertOwnerSession(event, input.sessionId);
		if (!session) return;
		const cols = clampInteger(input.cols, session.pty.cols, 20, MAX_COLS);
		const rows = clampInteger(input.rows, session.pty.rows, 5, MAX_ROWS);
		try {
			session.pty.resize(cols, rows);
		} catch {
			// Resize can fail while the process is exiting.
		}
	});

	ipcMain.on("terminal:kill", (event, input: TerminalKillInput = {}) => {
		const session = assertOwnerSession(event, input.sessionId);
		if (!session) return;
		disposeSession(session.id);
	});
}
