import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	app,
	BrowserWindow,
	dialog,
	ipcMain,
	Menu,
	nativeImage,
	session,
	systemPreferences,
	Tray,
} from "electron";
import { mainT, setMainLocale } from "./i18n";
import {
	getCurrentRecordingSessionState,
	getCursorTelemetryForVideo,
	getPersistedShortcuts,
	getSelectedDesktopSource,
	listDesktopSources,
	loadProjectFileFromDialog,
	openVideoFileFromDialog,
	registerIpcHandlers,
	requestAccessibilityAccessState,
	revealInFolderPath,
	savePersistedShortcuts,
	selectDesktopSource,
	setCurrentVideoPathState,
	startNewRecordingState,
} from "./ipc/handlers";
import { createRendererCommandBus } from "./mcp/RendererCommandBus";
import { createOpenScreenMcpResources } from "./mcp/resources";
import type { McpHttpServerController } from "./mcp/server";
import { startMcpServer } from "./mcp/server";
import type { OpenScreenMcpToolContext } from "./mcp/tools";
import type { RendererCommandTarget } from "./mcp/toolTypes";
import { RECORDINGS_DIR } from "./paths";
import {
	createCountdownOverlayWindow,
	createEditorWindow,
	createHudOverlayWindow,
	createSourceSelectorWindow,
} from "./windows";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Use Screen & System Audio Recording permissions instead of CoreAudio Tap API on macOS.
// CoreAudio Tap requires NSAudioCaptureUsageDescription in the parent app's Info.plist,
// which doesn't work when running from a terminal/IDE during development, makes my life easier
if (process.platform === "darwin") {
	app.commandLine.appendSwitch("disable-features", "MacCatapLoopbackAudioForScreenShare");
}

// Enable Wayland support for proper screen capture and window management
// on Wayland compositors (Hyprland, GNOME, KDE, etc.)
if (process.platform === "linux") {
	const isWayland =
		process.env.XDG_SESSION_TYPE === "wayland" || process.env.WAYLAND_DISPLAY !== undefined;
	if (isWayland) {
		app.commandLine.appendSwitch("ozone-platform", "wayland");
		// Enable WebRTCPipeWireCapturer for screen capture on Wayland
		app.commandLine.appendSwitch("enable-features", "WaylandWindowDrag,WebRTCPipeWireCapturer");
	}
}

async function ensureRecordingsDir() {
	try {
		await fs.mkdir(RECORDINGS_DIR, { recursive: true });
		console.log("RECORDINGS_DIR:", RECORDINGS_DIR);
		console.log("User Data Path:", app.getPath("userData"));
	} catch (error) {
		console.error("Failed to create recordings directory:", error);
	}
}

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, "..");

// Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
	? path.join(process.env.APP_ROOT, "public")
	: RENDERER_DIST;

// Window references
let mainWindow: BrowserWindow | null = null;
let sourceSelectorWindow: BrowserWindow | null = null;
let countdownOverlayWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let selectedSourceName = "";
let mcpServerController: McpHttpServerController | null = null;
const isMac = process.platform === "darwin";
const trayIconSize = isMac ? 16 : 24;

// Tray Icons
const defaultTrayIcon = getTrayIcon("openscreen.png", trayIconSize);
const recordingTrayIcon = getTrayIcon("rec-button.png", trayIconSize);

function createWindow() {
	mainWindow = createHudOverlayWindow();
}

function showMainWindow() {
	if (mainWindow && !mainWindow.isDestroyed()) {
		if (mainWindow.isMinimized()) {
			mainWindow.restore();
		}
		mainWindow.show();
		mainWindow.focus();
		return;
	}

	createWindow();
}

function isEditorWindow(window: BrowserWindow) {
	return window.webContents.getURL().includes("windowType=editor");
}

function sendEditorMenuAction(
	channel: "menu-load-project" | "menu-save-project" | "menu-save-project-as",
) {
	let targetWindow = BrowserWindow.getFocusedWindow() ?? mainWindow;

	if (!targetWindow || targetWindow.isDestroyed() || !isEditorWindow(targetWindow)) {
		createEditorWindowWrapper();
		targetWindow = mainWindow;
		if (!targetWindow || targetWindow.isDestroyed()) return;

		targetWindow.webContents.once("did-finish-load", () => {
			if (!targetWindow || targetWindow.isDestroyed()) return;
			targetWindow.webContents.send(channel);
		});
		return;
	}

	targetWindow.webContents.send(channel);
}

function setupApplicationMenu() {
	const isMac = process.platform === "darwin";
	const template: Electron.MenuItemConstructorOptions[] = [];

	if (isMac) {
		template.push({
			label: app.name,
			submenu: [
				{ role: "about" },
				{ type: "separator" },
				{ role: "services" },
				{ type: "separator" },
				{ role: "hide" },
				{ role: "hideOthers" },
				{ role: "unhide" },
				{ type: "separator" },
				{ role: "quit" },
			],
		});
	}

	template.push(
		{
			label: mainT("common", "actions.file") || "File",
			submenu: [
				{
					label: mainT("dialogs", "unsavedChanges.loadProject") || "Load Project…",
					accelerator: "CmdOrCtrl+O",
					click: () => sendEditorMenuAction("menu-load-project"),
				},
				{
					label: mainT("dialogs", "unsavedChanges.saveProject") || "Save Project…",
					accelerator: "CmdOrCtrl+S",
					click: () => sendEditorMenuAction("menu-save-project"),
				},
				{
					label: mainT("dialogs", "unsavedChanges.saveProjectAs") || "Save Project As…",
					accelerator: "CmdOrCtrl+Shift+S",
					click: () => sendEditorMenuAction("menu-save-project-as"),
				},
				...(isMac ? [] : [{ type: "separator" as const }, { role: "quit" as const }]),
			],
		},
		{
			label: mainT("common", "actions.edit") || "Edit",
			submenu: [
				{ role: "undo" },
				{ role: "redo" },
				{ type: "separator" },
				{ role: "cut" },
				{ role: "copy" },
				{ role: "paste" },
				{ role: "selectAll" },
			],
		},
		{
			label: mainT("common", "actions.view") || "View",
			submenu: [
				{ role: "reload" },
				{ role: "forceReload" },
				{ role: "toggleDevTools" },
				{ type: "separator" },
				{ role: "resetZoom" },
				{ role: "zoomIn" },
				{ role: "zoomOut" },
				{ type: "separator" },
				{ role: "togglefullscreen" },
			],
		},
		{
			label: mainT("common", "actions.window") || "Window",
			submenu: isMac
				? [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }]
				: [{ role: "minimize" }, { role: "close" }],
		},
	);

	const menu = Menu.buildFromTemplate(template);
	Menu.setApplicationMenu(menu);
}

function createTray() {
	tray = new Tray(defaultTrayIcon);
	tray.on("click", () => {
		showMainWindow();
	});
	tray.on("double-click", () => {
		showMainWindow();
	});
}

function getTrayIcon(filename: string, size: number) {
	return nativeImage
		.createFromPath(path.join(process.env.VITE_PUBLIC || RENDERER_DIST, filename))
		.resize({
			width: size,
			height: size,
			quality: "best",
		});
}

function updateTrayMenu(recording: boolean = false) {
	if (!tray) return;
	const trayIcon = recording ? recordingTrayIcon : defaultTrayIcon;
	const trayToolTip = recording ? `Recording: ${selectedSourceName}` : "OpenScreen";
	const menuTemplate = recording
		? [
				{
					label: mainT("common", "actions.stopRecording") || "Stop Recording",
					click: () => {
						if (mainWindow && !mainWindow.isDestroyed()) {
							mainWindow.webContents.send("stop-recording-from-tray");
						}
					},
				},
			]
		: [
				{
					label: mainT("common", "actions.open") || "Open",
					click: () => {
						showMainWindow();
					},
				},
				{
					label: mainT("common", "actions.quit") || "Quit",
					click: () => {
						app.quit();
					},
				},
			];
	tray.setImage(trayIcon);
	tray.setToolTip(trayToolTip);
	tray.setContextMenu(Menu.buildFromTemplate(menuTemplate));
}

let editorHasUnsavedChanges = false;
let isForceClosing = false;

ipcMain.on("set-has-unsaved-changes", (_, hasChanges: boolean) => {
	editorHasUnsavedChanges = hasChanges;
});

function forceCloseEditorWindow(windowToClose: BrowserWindow | null) {
	if (!windowToClose || windowToClose.isDestroyed()) return;

	isForceClosing = true;
	setImmediate(() => {
		try {
			if (!windowToClose.isDestroyed()) {
				windowToClose.close();
			}
		} finally {
			isForceClosing = false;
		}
	});
}

function createEditorWindowWrapper() {
	if (mainWindow) {
		isForceClosing = true;
		mainWindow.close();
		isForceClosing = false;
		mainWindow = null;
	}
	mainWindow = createEditorWindow();
	editorHasUnsavedChanges = false;

	mainWindow.on("close", (event) => {
		if (isForceClosing || !editorHasUnsavedChanges) return;

		event.preventDefault();

		const choice = dialog.showMessageBoxSync(mainWindow!, {
			type: "warning",
			buttons: [
				mainT("dialogs", "unsavedChanges.saveAndClose"),
				mainT("dialogs", "unsavedChanges.discardAndClose"),
				mainT("common", "actions.cancel"),
			],
			defaultId: 0,
			cancelId: 2,
			title: mainT("dialogs", "unsavedChanges.title"),
			message: mainT("dialogs", "unsavedChanges.message"),
			detail: mainT("dialogs", "unsavedChanges.detail"),
		});

		const windowToClose = mainWindow;
		if (!windowToClose || windowToClose.isDestroyed()) return;

		if (choice === 0) {
			// Save & Close — tell renderer to save, then close
			windowToClose.webContents.send("request-save-before-close");
			ipcMain.once("save-before-close-done", (_, shouldClose: boolean) => {
				if (!shouldClose) return;
				forceCloseEditorWindow(windowToClose);
			});
		} else if (choice === 1) {
			// Discard & Close
			forceCloseEditorWindow(windowToClose);
		}
		// choice === 2: Cancel — do nothing, window stays open
	});

	return mainWindow;
}

function createSourceSelectorWindowWrapper() {
	sourceSelectorWindow = createSourceSelectorWindow();
	sourceSelectorWindow.on("closed", () => {
		sourceSelectorWindow = null;
	});
	return sourceSelectorWindow;
}

function createCountdownOverlayWindowWrapper() {
	if (countdownOverlayWindow && !countdownOverlayWindow.isDestroyed()) {
		return countdownOverlayWindow;
	}

	countdownOverlayWindow = createCountdownOverlayWindow();
	countdownOverlayWindow.on("closed", () => {
		countdownOverlayWindow = null;
	});
	return countdownOverlayWindow;
}

// Closing every window quits the app entirely (tray icon goes too).
// The in-app "Return to Recorder" button covers the editor → HUD round-trip,
// so closing the last window is an explicit "I'm done" signal.
app.on("window-all-closed", () => {
	app.quit();
});

app.on("activate", () => {
	// On OS X it's common to re-create a window in the app when the
	// dock icon is clicked and there are no other windows open.
	const hasVisibleWindow = BrowserWindow.getAllWindows().some((window) => {
		if (window.isDestroyed() || !window.isVisible()) {
			return false;
		}

		const url = window.webContents.getURL();
		const isCountdownOverlayWindow = url.includes("windowType=countdown-overlay");
		return !isCountdownOverlayWindow;
	});
	if (!hasVisibleWindow) {
		showMainWindow();
	}
});

app.on("before-quit", () => {
	if (!mcpServerController) return;
	void mcpServerController.close().catch((error) => {
		console.warn("[mcp] Failed to close MCP server:", error);
	});
	mcpServerController = null;
});

// Register all IPC handlers when app is ready
app.whenReady().then(async () => {
	// Force the app into "regular" activation policy so the Dock icon appears.
	// The HUD overlay (transparent + frameless + skipTaskbar) is the first
	// window we open, and AppKit otherwise classifies us as an accessory app.
	if (process.platform === "darwin") {
		app.dock?.show();
	}

	// Allow microphone/media permission checks
	session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
		const allowed = ["media", "audioCapture", "microphone", "videoCapture", "camera"];
		return allowed.includes(permission);
	});

	session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
		const allowed = ["media", "audioCapture", "microphone", "videoCapture", "camera"];
		callback(allowed.includes(permission));
	});

	// Request microphone permission from macOS
	if (process.platform === "darwin") {
		const micStatus = systemPreferences.getMediaAccessStatus("microphone");
		if (micStatus !== "granted") {
			await systemPreferences.askForMediaAccess("microphone");
		}
	}

	// Listen for HUD overlay quit event (macOS only)
	ipcMain.on("hud-overlay-close", () => {
		app.quit();
	});
	ipcMain.handle("set-locale", (_, locale: string) => {
		setMainLocale(locale);
		setupApplicationMenu();
		updateTrayMenu();
	});

	createTray();
	updateTrayMenu();
	setupApplicationMenu();
	// Ensure recordings directory exists
	await ensureRecordingsDir();

	function switchToHudWrapper() {
		if (mainWindow) {
			isForceClosing = true;
			mainWindow.close();
			isForceClosing = false;
			mainWindow = null;
		}
		showMainWindow();
		return mainWindow;
	}

	function getWindowType(window: BrowserWindow | null) {
		if (!window || window.isDestroyed()) {
			return null;
		}

		const url = window.webContents.getURL();
		if (url.includes("windowType=editor")) {
			return "editor";
		}
		if (url.includes("windowType=hud-overlay")) {
			return "hud";
		}
		return null;
	}

	function getMcpTargetWindow(target: RendererCommandTarget) {
		const expectedType = target === "editor" ? "editor" : "hud";
		if (getWindowType(mainWindow) === expectedType) {
			return mainWindow;
		}

		return (
			BrowserWindow.getAllWindows().find(
				(window) => !window.isDestroyed() && getWindowType(window) === expectedType,
			) ?? null
		);
	}

	function ensureMcpTargetWindow(target: RendererCommandTarget) {
		const existing = getMcpTargetWindow(target);
		if (existing) {
			if (existing.isMinimized()) {
				existing.restore();
			}
			existing.show();
			if (target === "editor") {
				existing.focus();
			}
			return existing;
		}

		return target === "editor" ? createEditorWindowWrapper() : switchToHudWrapper();
	}

	function getMcpWindowStatus() {
		const hudWindow = getMcpTargetWindow("hud");
		const editorWindow = getMcpTargetWindow("editor");
		return {
			hud: hudWindow
				? {
						visible: hudWindow.isVisible(),
						loading: hudWindow.webContents.isLoading(),
					}
				: null,
			editor: editorWindow
				? {
						visible: editorWindow.isVisible(),
						loading: editorWindow.webContents.isLoading(),
						hasUnsavedChanges: editorHasUnsavedChanges,
					}
				: null,
			sourceSelector: sourceSelectorWindow
				? {
						visible: sourceSelectorWindow.isVisible(),
						loading: sourceSelectorWindow.webContents.isLoading(),
					}
				: null,
			countdownOverlay: countdownOverlayWindow
				? {
						visible: countdownOverlayWindow.isVisible(),
						loading: countdownOverlayWindow.webContents.isLoading(),
					}
				: null,
		};
	}

	registerIpcHandlers(
		createEditorWindowWrapper,
		createSourceSelectorWindowWrapper,
		createCountdownOverlayWindowWrapper,
		() => mainWindow,
		() => sourceSelectorWindow,
		() => countdownOverlayWindow,
		(recording: boolean, sourceName: string) => {
			selectedSourceName = sourceName;
			if (!tray) createTray();
			updateTrayMenu(recording);
			if (!recording) {
				showMainWindow();
			}
		},
		switchToHudWrapper,
	);

	const commandBus = createRendererCommandBus({
		getWindow: getMcpTargetWindow,
		ensureWindow: ensureMcpTargetWindow,
	});
	const toolContext: OpenScreenMcpToolContext = {
		commandBus,
		sources: {
			list: listDesktopSources,
			select: async (source) =>
				selectDesktopSource(source, () => sourceSelectorWindow) as ProcessedDesktopSource | null,
			getSelected: () => getSelectedDesktopSource() as ProcessedDesktopSource | null,
		},
		media: {
			openVideoFilePicker: () => openVideoFileFromDialog(() => mainWindow),
			setCurrentVideoPath: setCurrentVideoPathState,
			getCurrentRecordingSession: getCurrentRecordingSessionState,
			getCursorTelemetry: getCursorTelemetryForVideo,
		},
		project: {
			loadProjectFile: () => loadProjectFileFromDialog(() => mainWindow),
			startNewRecording: () => startNewRecordingState(switchToHudWrapper),
		},
		windows: {
			switchToEditor: () => createEditorWindowWrapper(),
		},
		locale: {
			setMainLocale: (locale: string) => {
				setMainLocale(locale);
				setupApplicationMenu();
				updateTrayMenu();
			},
		},
		platform: {
			isMac,
			name: process.platform,
		},
		permissions: {
			requestAccessibilityAccess: requestAccessibilityAccessState,
		},
		files: {
			revealInFolder: revealInFolderPath,
		},
		shortcuts: {
			getShortcuts: getPersistedShortcuts,
			saveShortcuts: savePersistedShortcuts,
		},
	};
	const resources = createOpenScreenMcpResources({
		app: {
			getName: () => app.getName(),
			getVersion: () => app.getVersion(),
		},
		windows: {
			getStatus: getMcpWindowStatus,
		},
		tools: toolContext,
		server: {
			getStatus: () => mcpServerController?.getStatus() ?? { running: false },
		},
	});

	try {
		mcpServerController = await startMcpServer({
			host: "127.0.0.1",
			port: 18888,
			path: "/mcp",
			context: toolContext,
			resources,
			appVersion: app.getVersion(),
		});
		console.log(`[mcp] Streamable HTTP server listening at ${mcpServerController.url}`);
	} catch (error) {
		console.error("[mcp] Failed to start Streamable HTTP server:", error);
	}

	createWindow();
});
