import { randomUUID } from "node:crypto";
import { BrowserWindow, ipcMain } from "electron";
import type { RendererCommandBus, RendererCommandTarget } from "./toolTypes";

interface RendererCommandEnvelope {
	id: string;
	target: RendererCommandTarget;
	method: string;
	args: unknown;
}

interface RendererCommandResponse {
	id: string;
	ok: boolean;
	result?: unknown;
	error?: string;
}

interface PendingCommand {
	target: RendererCommandTarget;
	method: string;
	webContentsId: number;
	resolve: (value: unknown) => void;
	reject: (reason?: unknown) => void;
	timer: ReturnType<typeof setTimeout>;
}

interface RendererCommandBusOptions {
	getWindow: (target: RendererCommandTarget) => BrowserWindow | null;
	ensureWindow: (target: RendererCommandTarget) => BrowserWindow | null;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const READY_TIMEOUT_MS = 10_000;

function isValidTarget(value: unknown): value is RendererCommandTarget {
	return value === "hud" || value === "editor";
}

function isResponse(value: unknown): value is RendererCommandResponse {
	return Boolean(
		value &&
			typeof value === "object" &&
			typeof (value as RendererCommandResponse).id === "string" &&
			typeof (value as RendererCommandResponse).ok === "boolean",
	);
}

export function createRendererCommandBus(options: RendererCommandBusOptions): RendererCommandBus {
	const pending = new Map<string, PendingCommand>();
	const readyTargets = new Map<number, Set<RendererCommandTarget>>();
	const registeredWindows = new Set<number>();

	function registerWindow(win: BrowserWindow) {
		const webContentsId = win.webContents.id;
		if (registeredWindows.has(webContentsId)) {
			return;
		}

		registeredWindows.add(webContentsId);
		win.on("closed", () => {
			readyTargets.delete(webContentsId);
			registeredWindows.delete(webContentsId);
			for (const [id, command] of pending.entries()) {
				if (command.webContentsId !== webContentsId) {
					continue;
				}
				clearTimeout(command.timer);
				pending.delete(id);
				command.reject(new Error(`Renderer window closed before ${command.method} completed.`));
			}
		});
	}

	function markReady(webContentsId: number, target: RendererCommandTarget) {
		const targets = readyTargets.get(webContentsId) ?? new Set<RendererCommandTarget>();
		targets.add(target);
		readyTargets.set(webContentsId, targets);
	}

	function isReady(win: BrowserWindow, target: RendererCommandTarget) {
		return readyTargets.get(win.webContents.id)?.has(target) ?? false;
	}

	function waitForReady(
		win: BrowserWindow,
		target: RendererCommandTarget,
		timeoutMs: number,
	): Promise<void> {
		if (isReady(win, target)) {
			return Promise.resolve();
		}

		return new Promise((resolve, reject) => {
			const startedAt = Date.now();
			const interval = setInterval(() => {
				if (win.isDestroyed()) {
					clearInterval(interval);
					reject(new Error(`Renderer window for ${target} closed before it became ready.`));
					return;
				}

				if (isReady(win, target)) {
					clearInterval(interval);
					resolve();
					return;
				}

				if (Date.now() - startedAt >= timeoutMs) {
					clearInterval(interval);
					reject(new Error(`Timed out waiting for ${target} renderer MCP handler.`));
				}
			}, 50);
		});
	}

	ipcMain.on("mcp:renderer-ready", (event, target: unknown) => {
		if (!isValidTarget(target)) {
			return;
		}
		markReady(event.sender.id, target);
	});

	ipcMain.on("mcp:command-result", (_event, response: unknown) => {
		if (!isResponse(response)) {
			return;
		}

		const command = pending.get(response.id);
		if (!command) {
			return;
		}

		clearTimeout(command.timer);
		pending.delete(response.id);

		if (response.ok) {
			command.resolve(response.result);
			return;
		}

		command.reject(new Error(response.error || "Renderer command failed."));
	});

	return {
		async send<TResult = unknown>(
			target: RendererCommandTarget,
			method: string,
			args: unknown,
			commandOptions?: { timeoutMs?: number; ensureWindow?: boolean },
		): Promise<TResult> {
			const timeoutMs = commandOptions?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
			const shouldEnsureWindow = commandOptions?.ensureWindow ?? false;
			const win = shouldEnsureWindow ? options.ensureWindow(target) : options.getWindow(target);

			if (!win || win.isDestroyed()) {
				throw new Error(`${target} renderer window is not available.`);
			}

			registerWindow(win);

			if (win.webContents.isLoading()) {
				await new Promise<void>((resolve, reject) => {
					const timer = setTimeout(
						() => {
							reject(new Error(`Timed out waiting for ${target} renderer to load.`));
						},
						Math.min(timeoutMs, READY_TIMEOUT_MS),
					);
					win.webContents.once("did-finish-load", () => {
						clearTimeout(timer);
						resolve();
					});
				});
			}

			await waitForReady(win, target, Math.min(timeoutMs, READY_TIMEOUT_MS));

			const id = randomUUID();
			const envelope: RendererCommandEnvelope = { id, target, method, args };
			const result = await new Promise<unknown>((resolve, reject) => {
				const timer = setTimeout(() => {
					pending.delete(id);
					reject(new Error(`Renderer command timed out: ${target}.${method}`));
				}, timeoutMs);

				pending.set(id, {
					target,
					method,
					webContentsId: win.webContents.id,
					resolve,
					reject,
					timer,
				});

				win.webContents.send("mcp:command", envelope);
			});

			return result as TResult;
		},
	};
}
