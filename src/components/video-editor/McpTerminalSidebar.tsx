import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XtermTerminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
	Bot,
	Check,
	Clipboard,
	MessageSquare,
	Play,
	Server,
	ShieldAlert,
	ShieldCheck,
	Terminal as TerminalIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type SidebarTab = "terminal" | "mcp";

type McpServerStatus = {
	running?: boolean;
	url?: string;
	host?: string;
	port?: number;
	path?: string;
	startedAt?: string;
	sessionCount?: number;
	authRequired?: boolean;
	error?: string | null;
};

type TerminalRuntimeStatus = "idle" | "starting" | "running" | "exited" | "error";
type McpClientTarget = "codex" | "claude";

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

const MCP_ENDPOINT = "http://127.0.0.1:18888/mcp";
const TERM_FONT =
	'"SFMono-Regular", "Cascadia Code", "Liberation Mono", Menlo, Consolas, monospace';

function createTerminal() {
	return new XtermTerminal({
		allowTransparency: true,
		convertEol: true,
		cursorBlink: true,
		fontFamily: TERM_FONT,
		fontSize: 12,
		lineHeight: 1.2,
		scrollback: 4000,
		theme: {
			background: "#050507",
			foreground: "#d8dee9",
			cursor: "#34B27B",
			selectionBackground: "#34B27B33",
			black: "#09090b",
			blue: "#82aaff",
			cyan: "#89ddff",
			green: "#34B27B",
			magenta: "#c792ea",
			red: "#ff6b6b",
			white: "#d8dee9",
			yellow: "#ffd166",
		},
	});
}

function formatStartedAt(startedAt?: string) {
	if (!startedAt) return "not started";
	try {
		return new Intl.DateTimeFormat(undefined, {
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		}).format(new Date(startedAt));
	} catch {
		return startedAt;
	}
}

function statusLabel(status: McpServerStatus | null) {
	if (status?.running) return "Listening";
	if (status?.error) return "Error";
	return "Offline";
}

function writePrompt(terminal: XtermTerminal) {
	terminal.write("\r\n\x1b[38;5;77mmcp\x1b[0m> ");
}

function writeStatus(terminal: XtermTerminal, status: McpServerStatus) {
	const label = statusLabel(status);
	const color = status.running ? "32" : status.error ? "31" : "33";
	terminal.writeln(`\x1b[1;${color}m${label}\x1b[0m`);
	terminal.writeln(`endpoint: ${status.url ?? MCP_ENDPOINT}`);
	terminal.writeln(`sessions: ${status.sessionCount ?? 0}`);
	terminal.writeln(`auth: ${status.authRequired ? "bearer token required" : "local only"}`);
	terminal.writeln(`started: ${formatStartedAt(status.startedAt)}`);
	if (status.error) {
		terminal.writeln(`error: ${status.error}`);
	}
}

function createSessionId() {
	return globalThis.crypto?.randomUUID?.() ?? `terminal-${Date.now()}-${Math.random()}`;
}

function tabButtonClass(active: boolean) {
	return `h-7 flex-1 inline-flex items-center justify-center gap-1.5 rounded-md text-[11px] font-medium transition-colors ${
		active ? "bg-white/10 text-slate-100" : "text-slate-500 hover:text-slate-200 hover:bg-white/5"
	}`;
}

function configTargetTitle(target: McpClientTarget) {
	return target === "codex" ? "Codex" : "Claude Code";
}

function configFileLabel(target: McpClientTarget) {
	return target === "codex" ? ".codex/config.toml" : ".mcp.json";
}

export function McpTerminalSidebar() {
	const mcpContainerRef = useRef<HTMLDivElement>(null);
	const terminalContainerRef = useRef<HTMLDivElement>(null);
	const mcpTerminalRef = useRef<XtermTerminal | null>(null);
	const terminalRef = useRef<XtermTerminal | null>(null);
	const mcpFitAddonRef = useRef<FitAddon | null>(null);
	const terminalFitAddonRef = useRef<FitAddon | null>(null);
	const terminalSessionIdRef = useRef<string | null>(null);
	const terminalCleanupRef = useRef<(() => void) | null>(null);
	const pendingTerminalCommandRef = useRef<string | null>(null);
	const statusRef = useRef<McpServerStatus | null>(null);

	const [activeTab, setActiveTab] = useState<SidebarTab>("terminal");
	const [status, setStatus] = useState<McpServerStatus | null>(null);
	const [terminalStatus, setTerminalStatus] = useState<TerminalRuntimeStatus>("idle");
	const [mcpClientConfig, setMcpClientConfig] = useState<McpClientConfigInfo | null>(null);
	const [configModalTarget, setConfigModalTarget] = useState<McpClientTarget | null>(null);
	const [copiedKey, setCopiedKey] = useState<string | null>(null);

	const readStatus = useCallback(async () => {
		try {
			const next = await window.electronAPI.getMcpServerStatus();
			statusRef.current = next;
			setStatus(next);
			return next;
		} catch (error) {
			const next: McpServerStatus = {
				running: false,
				url: MCP_ENDPOINT,
				sessionCount: 0,
				authRequired: false,
				error: error instanceof Error ? error.message : String(error),
			};
			statusRef.current = next;
			setStatus(next);
			return next;
		}
	}, []);

	const refreshMcpClientConfig = useCallback(async () => {
		const next = await window.electronAPI.getMcpClientConfig();
		setMcpClientConfig(next);
		return next;
	}, []);

	const fitMcpTerminal = useCallback(() => {
		try {
			mcpFitAddonRef.current?.fit();
		} catch {
			// The fit addon can throw while the panel is being resized to zero.
		}
	}, []);

	const fitShellTerminal = useCallback(() => {
		try {
			terminalFitAddonRef.current?.fit();
			const sessionId = terminalSessionIdRef.current;
			const terminal = terminalRef.current;
			if (sessionId && terminal) {
				window.electronAPI.resizeTerminal(sessionId, terminal.cols, terminal.rows);
			}
		} catch {
			// The fit addon can throw while the panel is being resized to zero.
		}
	}, []);

	const runMcpCommand = useCallback(
		async (terminal: XtermTerminal, rawCommand: string) => {
			const command = rawCommand.trim();

			if (!command) {
				writePrompt(terminal);
				return;
			}

			if (command === "clear") {
				terminal.clear();
				writePrompt(terminal);
				return;
			}

			if (command === "help") {
				terminal.writeln("commands:");
				terminal.writeln("  status    refresh MCP server status");
				terminal.writeln("  url       print the Streamable HTTP endpoint");
				terminal.writeln("  sessions  print active MCP session count");
				terminal.writeln("  auth      print current MCP auth mode");
				terminal.writeln("  clear     clear the console");
				writePrompt(terminal);
				return;
			}

			if (command === "status") {
				writeStatus(terminal, await readStatus());
				writePrompt(terminal);
				return;
			}

			if (command === "url") {
				const next = statusRef.current ?? (await readStatus());
				terminal.writeln(next.url ?? MCP_ENDPOINT);
				writePrompt(terminal);
				return;
			}

			if (command === "sessions") {
				const next = await readStatus();
				terminal.writeln(String(next.sessionCount ?? 0));
				writePrompt(terminal);
				return;
			}

			if (command === "auth") {
				const next = statusRef.current ?? (await readStatus());
				terminal.writeln(next.authRequired ? "bearer token required" : "local only");
				writePrompt(terminal);
				return;
			}

			terminal.writeln(`unknown command: ${command}`);
			terminal.writeln("type `help` for available commands");
			writePrompt(terminal);
		},
		[readStatus],
	);

	const startShellTerminal = useCallback(async () => {
		if (terminalSessionIdRef.current) return;
		if (terminalRef.current) {
			terminalCleanupRef.current?.();
			terminalCleanupRef.current = null;
			terminalRef.current.dispose();
			terminalRef.current = null;
			terminalFitAddonRef.current = null;
		}
		if (!terminalContainerRef.current) return;

		const terminal = createTerminal();
		const fitAddon = new FitAddon();
		const sessionId = createSessionId();
		terminalRef.current = terminal;
		terminalFitAddonRef.current = fitAddon;
		terminalSessionIdRef.current = sessionId;
		setTerminalStatus("starting");

		terminal.loadAddon(fitAddon);
		terminal.open(terminalContainerRef.current);
		window.setTimeout(fitShellTerminal, 0);

		const removeDataListener = window.electronAPI.onTerminalData(sessionId, (data) => {
			terminal.write(data);
		});
		const removeExitListener = window.electronAPI.onTerminalExit(sessionId, ({ exitCode }) => {
			setTerminalStatus("exited");
			terminal.writeln("");
			terminal.writeln(`\x1b[33m[process exited with code ${exitCode}]\x1b[0m`);
			terminalSessionIdRef.current = null;
		});
		const dataDisposable = terminal.onData((data) => {
			window.electronAPI.writeTerminal(sessionId, data);
		});
		terminalCleanupRef.current = () => {
			dataDisposable.dispose();
			removeDataListener();
			removeExitListener();
			window.electronAPI.killTerminal(sessionId);
		};

		window.setTimeout(async () => {
			fitShellTerminal();
			const result = await window.electronAPI.createTerminal({
				sessionId,
				cols: terminal.cols,
				rows: terminal.rows,
				mode: "shell",
			});
			if (!result.success) {
				setTerminalStatus("error");
				terminal.writeln(
					`\x1b[31mFailed to start terminal: ${result.error ?? "unknown error"}\x1b[0m`,
				);
				return;
			}

			if (result.mcpClientConfig) {
				setMcpClientConfig(result.mcpClientConfig);
			}
			setTerminalStatus("running");
			const pendingCommand = pendingTerminalCommandRef.current;
			if (pendingCommand) {
				pendingTerminalCommandRef.current = null;
				window.electronAPI.writeTerminal(sessionId, `${pendingCommand}\r`);
			}
		}, 0);
	}, [fitShellTerminal]);

	const sendTerminalCommand = useCallback(
		(command: "codex" | "claude") => {
			setActiveTab("terminal");
			const sessionId = terminalSessionIdRef.current;
			if (!sessionId || terminalStatus !== "running") {
				pendingTerminalCommandRef.current = command;
				void startShellTerminal();
				return;
			}

			window.electronAPI.writeTerminal(sessionId, `${command}\r`);
			terminalRef.current?.focus();
		},
		[startShellTerminal, terminalStatus],
	);

	const openConfigModal = useCallback(
		(target: McpClientTarget) => {
			setConfigModalTarget(target);
			setCopiedKey(null);
			void refreshMcpClientConfig();
		},
		[refreshMcpClientConfig],
	);

	const copyText = useCallback(async (key: string, text: string) => {
		try {
			await navigator.clipboard.writeText(text);
			setCopiedKey(key);
			window.setTimeout(() => setCopiedKey(null), 1500);
		} catch {
			setCopiedKey(null);
		}
	}, []);

	useEffect(() => {
		void readStatus();
		const interval = window.setInterval(() => {
			void readStatus();
		}, 3000);

		return () => window.clearInterval(interval);
	}, [readStatus]);

	useEffect(() => {
		void refreshMcpClientConfig();
	}, [refreshMcpClientConfig]);

	useEffect(() => {
		const container = mcpContainerRef.current;
		if (!container || mcpTerminalRef.current) return;

		let commandBuffer = "";
		const terminal = createTerminal();
		const fitAddon = new FitAddon();
		terminal.loadAddon(fitAddon);
		terminal.open(container);
		mcpTerminalRef.current = terminal;
		mcpFitAddonRef.current = fitAddon;

		window.setTimeout(fitMcpTerminal, 0);
		terminal.writeln("\x1b[1;32mOpenScreen MCP console\x1b[0m");
		terminal.writeln("type `help` for commands");
		void readStatus().then((next) => {
			terminal.writeln("");
			writeStatus(terminal, next);
			writePrompt(terminal);
		});

		const dataDisposable = terminal.onData((data) => {
			if (data.startsWith("\u001b")) {
				return;
			}

			for (const char of data) {
				if (char === "\r") {
					const command = commandBuffer;
					commandBuffer = "";
					terminal.write("\r\n");
					void runMcpCommand(terminal, command);
					continue;
				}

				if (char === "\u0003") {
					commandBuffer = "";
					terminal.write("^C");
					writePrompt(terminal);
					continue;
				}

				if (char === "\u000c") {
					terminal.clear();
					commandBuffer = "";
					writePrompt(terminal);
					continue;
				}

				if (char === "\u007f" || char === "\b") {
					if (commandBuffer.length > 0) {
						commandBuffer = commandBuffer.slice(0, -1);
						terminal.write("\b \b");
					}
					continue;
				}

				if (char === "\t") {
					commandBuffer += "  ";
					terminal.write("  ");
					continue;
				}

				if (char >= " " && char !== "\u001b") {
					commandBuffer += char;
					terminal.write(char);
				}
			}
		});

		return () => {
			dataDisposable.dispose();
			terminal.dispose();
			mcpTerminalRef.current = null;
			mcpFitAddonRef.current = null;
		};
	}, [fitMcpTerminal, readStatus, runMcpCommand]);

	useEffect(() => {
		void startShellTerminal();
	}, [startShellTerminal]);

	useEffect(() => {
		const mcpContainer = mcpContainerRef.current;
		const terminalContainer = terminalContainerRef.current;
		const fitActive = () => {
			if (activeTab === "terminal") {
				fitShellTerminal();
			} else {
				fitMcpTerminal();
			}
		};

		window.setTimeout(fitActive, 0);
		let mcpObserver: ResizeObserver | null = null;
		let terminalObserver: ResizeObserver | null = null;
		if (typeof ResizeObserver !== "undefined") {
			if (mcpContainer) {
				mcpObserver = new ResizeObserver(fitActive);
				mcpObserver.observe(mcpContainer);
			}
			if (terminalContainer) {
				terminalObserver = new ResizeObserver(fitActive);
				terminalObserver.observe(terminalContainer);
			}
		} else {
			window.addEventListener("resize", fitActive);
		}

		return () => {
			mcpObserver?.disconnect();
			terminalObserver?.disconnect();
			if (!mcpObserver && !terminalObserver) {
				window.removeEventListener("resize", fitActive);
			}
		};
	}, [activeTab, fitMcpTerminal, fitShellTerminal]);

	useEffect(() => {
		return () => {
			terminalCleanupRef.current?.();
			terminalCleanupRef.current = null;
			terminalRef.current?.dispose();
			terminalRef.current = null;
			terminalFitAddonRef.current = null;
			terminalSessionIdRef.current = null;
		};
	}, []);

	const running = status?.running === true;
	const endpoint = status?.url ?? MCP_ENDPOINT;
	const sessionCount = status?.sessionCount ?? 0;
	const modalConfig =
		configModalTarget && mcpClientConfig ? mcpClientConfig[configModalTarget] : null;
	const modalManualCommands = modalConfig?.manualCommands.join("\n") ?? "";

	return (
		<aside className="h-full bg-[#09090b] rounded-2xl border border-white/5 shadow-lg overflow-hidden flex flex-col">
			<header className="flex-shrink-0 border-b border-white/5 px-4 py-3">
				<div className="flex items-center gap-3">
					<div className="h-9 w-9 rounded-md bg-white/5 border border-white/10 flex items-center justify-center text-[#34B27B]">
						<Server size={17} />
					</div>
					<div className="min-w-0 flex-1">
						<div className="flex items-center justify-between gap-2">
							<h2 className="text-xs font-semibold text-slate-100">MCP Server</h2>
							<span
								className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${
									running
										? "bg-[#34B27B]/15 text-[#78d8aa]"
										: status?.error
											? "bg-red-500/15 text-red-300"
											: "bg-yellow-500/15 text-yellow-200"
								}`}
							>
								<span
									className={`h-1.5 w-1.5 rounded-full ${
										running ? "bg-[#34B27B]" : status?.error ? "bg-red-400" : "bg-yellow-300"
									}`}
								/>
								{statusLabel(status)}
							</span>
						</div>
						<div className="mt-1 truncate text-[10px] text-slate-500">{endpoint}</div>
						<div className="mt-1 flex items-center gap-2 text-[10px] text-slate-500">
							<span>{sessionCount} sessions</span>
							<span className="h-1 w-1 rounded-full bg-white/15" />
							<span className="inline-flex items-center gap-1">
								{status?.authRequired ? <ShieldAlert size={11} /> : <ShieldCheck size={11} />}
								{status?.authRequired ? "token" : "local"}
							</span>
						</div>
					</div>
				</div>

				<div className="mt-3 flex items-center rounded-md bg-black/30 p-1 border border-white/5">
					<button
						type="button"
						className={tabButtonClass(activeTab === "terminal")}
						onClick={() => setActiveTab("terminal")}
					>
						<TerminalIcon size={13} />
						Terminal
					</button>
					<button
						type="button"
						className={tabButtonClass(activeTab === "mcp")}
						onClick={() => setActiveTab("mcp")}
					>
						<MessageSquare size={13} />
						MCP Console
					</button>
				</div>

				{activeTab === "terminal" ? (
					<div className="mt-2 flex items-center gap-2">
						<button
							type="button"
							className="h-7 flex-1 inline-flex items-center justify-center gap-1.5 rounded-md bg-white/5 text-[11px] font-medium text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
							onClick={() => openConfigModal("codex")}
						>
							<Bot size={13} />
							Codex
						</button>
						<button
							type="button"
							className="h-7 flex-1 inline-flex items-center justify-center gap-1.5 rounded-md bg-white/5 text-[11px] font-medium text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
							onClick={() => openConfigModal("claude")}
						>
							<Bot size={13} />
							Claude Code
						</button>
						<span
							className={`h-7 min-w-[64px] inline-flex items-center justify-center rounded-md px-2 text-[10px] font-medium ${
								terminalStatus === "running"
									? "bg-[#34B27B]/10 text-[#78d8aa]"
									: terminalStatus === "error"
										? "bg-red-500/10 text-red-300"
										: "bg-white/5 text-slate-500"
							}`}
						>
							{terminalStatus}
						</span>
					</div>
				) : null}
			</header>

			<div className="relative min-h-0 flex-1 bg-[#050507]">
				<div
					ref={terminalContainerRef}
					className={`mcp-terminal absolute inset-0 ${activeTab === "terminal" ? "" : "opacity-0 pointer-events-none"}`}
					aria-label="Terminal"
				/>
				<div
					ref={mcpContainerRef}
					className={`mcp-terminal absolute inset-0 ${activeTab === "mcp" ? "" : "opacity-0 pointer-events-none"}`}
					aria-label="MCP console"
				/>
			</div>

			{configModalTarget ? (
				<div className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/70 px-6">
					<div className="w-full max-w-[680px] max-h-[82vh] overflow-hidden rounded-lg border border-white/10 bg-[#09090b] shadow-2xl flex flex-col">
						<div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
							<div className="min-w-0">
								<div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
									<Bot size={16} className="text-[#34B27B]" />
									{configTargetTitle(configModalTarget)} MCP configuration
								</div>
								<p className="mt-1 text-xs text-slate-500">
									Project-scoped OpenScreen MCP settings are injected before terminal launch.
								</p>
							</div>
							<button
								type="button"
								className="rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-white/10 hover:text-white"
								onClick={() => setConfigModalTarget(null)}
							>
								Close
							</button>
						</div>

						<div className="min-h-0 overflow-y-auto px-5 py-4 space-y-4">
							<div className="grid grid-cols-2 gap-3 text-xs">
								<div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
									<div className="text-slate-500">Project root</div>
									<div className="mt-1 truncate text-slate-200">
										{mcpClientConfig?.projectRoot ?? "Loading..."}
									</div>
								</div>
								<div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
									<div className="text-slate-500">Endpoint</div>
									<div className="mt-1 truncate text-slate-200">
										{mcpClientConfig?.endpoint ?? endpoint}
									</div>
								</div>
								<div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
									<div className="text-slate-500">Project file</div>
									<div className="mt-1 truncate text-slate-200">
										{modalConfig?.path ?? configFileLabel(configModalTarget)}
									</div>
								</div>
								<div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
									<div className="text-slate-500">Injection status</div>
									<div
										className={`mt-1 ${modalConfig?.success ? "text-[#78d8aa]" : "text-red-300"}`}
									>
										{modalConfig ? (modalConfig.success ? "Applied" : "Failed") : "Loading"}
									</div>
								</div>
							</div>

							{mcpClientConfig?.authRequired ? (
								<div className="rounded-md border border-yellow-400/20 bg-yellow-400/10 px-3 py-2 text-xs text-yellow-100">
									This MCP server requires a bearer token. The project config references{" "}
									<span className="font-mono">{mcpClientConfig.tokenEnvVar}</span> and does not
									write the token value into project files.
								</div>
							) : null}

							{modalConfig?.error ? (
								<div className="rounded-md border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
									{modalConfig.error}
								</div>
							) : null}

							<section>
								<div className="mb-2 flex items-center justify-between gap-2">
									<h3 className="text-xs font-semibold text-slate-300">
										Injected {configFileLabel(configModalTarget)}
									</h3>
									<button
										type="button"
										className="inline-flex items-center gap-1 rounded-md bg-white/5 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/10"
										disabled={!modalConfig}
										onClick={() =>
											modalConfig &&
											void copyText(`${configModalTarget}-snippet`, modalConfig.snippet)
										}
									>
										{copiedKey === `${configModalTarget}-snippet` ? (
											<Check size={12} />
										) : (
											<Clipboard size={12} />
										)}
										Copy
									</button>
								</div>
								<pre className="max-h-56 overflow-auto rounded-md border border-white/10 bg-black/40 p-3 text-[11px] leading-5 text-slate-200">
									{modalConfig?.snippet ?? "Loading..."}
								</pre>
							</section>

							<section>
								<div className="mb-2 flex items-center justify-between gap-2">
									<h3 className="text-xs font-semibold text-slate-300">Manual CLI registration</h3>
									<button
										type="button"
										className="inline-flex items-center gap-1 rounded-md bg-white/5 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/10"
										disabled={!modalConfig}
										onClick={() =>
											modalConfig &&
											void copyText(`${configModalTarget}-commands`, modalManualCommands)
										}
									>
										{copiedKey === `${configModalTarget}-commands` ? (
											<Check size={12} />
										) : (
											<Clipboard size={12} />
										)}
										Copy
									</button>
								</div>
								<pre className="max-h-40 overflow-auto rounded-md border border-white/10 bg-black/40 p-3 text-[11px] leading-5 text-slate-200">
									{modalManualCommands || "Loading..."}
								</pre>
							</section>
						</div>

						<div className="flex items-center justify-end gap-2 border-t border-white/10 px-5 py-3">
							<button
								type="button"
								className="rounded-md bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/10 hover:text-white"
								onClick={() => setConfigModalTarget(null)}
							>
								Close
							</button>
							<button
								type="button"
								className="inline-flex items-center gap-1.5 rounded-md bg-[#34B27B] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#34B27B]/90"
								onClick={() => {
									sendTerminalCommand(configModalTarget);
									setConfigModalTarget(null);
								}}
							>
								<Play size={13} />
								Run {configTargetTitle(configModalTarget)}
							</button>
						</div>
					</div>
				</div>
			) : null}
		</aside>
	);
}
