/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
	interface ProcessEnv {
		/**
		 * The built directory structure
		 *
		 * ```tree
		 * ├─┬─┬ dist
		 * │ │ └── index.html
		 * │ │
		 * │ ├─┬ dist-electron
		 * │ │ ├── main.js
		 * │ │ └── preload.js
		 * │
		 * ```
		 */
		APP_ROOT: string;
		/** /dist/ or /public/ */
		VITE_PUBLIC: string;
	}
}

// Used in Renderer process, expose in `preload.ts`
interface Window {
	electronAPI: {
		getSources: (opts: Electron.SourcesOptions) => Promise<ProcessedDesktopSource[]>;
		switchToEditor: () => Promise<void>;
		switchToHud: () => Promise<void>;
		startNewRecording: () => Promise<{ success: boolean; error?: string }>;
		openSourceSelector: () => Promise<void>;
		selectSource: (source: ProcessedDesktopSource) => Promise<ProcessedDesktopSource | null>;
		getSelectedSource: () => Promise<ProcessedDesktopSource | null>;
		requestCameraAccess: () => Promise<{
			success: boolean;
			granted: boolean;
			status: string;
			error?: string;
		}>;
		requestAccessibilityAccess: () => Promise<{
			success: boolean;
			granted: boolean;
			error?: string;
		}>;
		assetBaseUrl: string;
		storeRecordedVideo: (
			videoData: ArrayBuffer,
			fileName: string,
		) => Promise<{
			success: boolean;
			path?: string;
			session?: import("../src/lib/recordingSession").RecordingSession;
			message?: string;
			error?: string;
		}>;
		storeRecordedSession: (
			payload: import("../src/lib/recordingSession").StoreRecordedSessionInput,
		) => Promise<{
			success: boolean;
			path?: string;
			session?: import("../src/lib/recordingSession").RecordingSession;
			message?: string;
			error?: string;
		}>;
		getRecordedVideoPath: () => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			error?: string;
		}>;
		setRecordingState: (recording: boolean, recordingId?: number) => Promise<void>;
		discardCursorTelemetry: (recordingId: number) => Promise<void>;
		getCursorTelemetry: (videoPath?: string) => Promise<{
			success: boolean;
			samples: CursorTelemetryPoint[];
			clicks: number[];
			message?: string;
			error?: string;
		}>;
		onStopRecordingFromTray: (callback: () => void) => () => void;
		openExternalUrl: (url: string) => Promise<{ success: boolean; error?: string }>;
		saveExportedVideo: (
			videoData: ArrayBuffer,
			fileName: string,
		) => Promise<{ success: boolean; path?: string; message?: string; canceled?: boolean }>;
		openVideoFilePicker: () => Promise<{ success: boolean; path?: string; canceled?: boolean }>;
		setCurrentVideoPath: (path: string) => Promise<{ success: boolean }>;
		setCurrentRecordingSession: (
			session: import("../src/lib/recordingSession").RecordingSession | null,
		) => Promise<{
			success: boolean;
			session?: import("../src/lib/recordingSession").RecordingSession;
		}>;
		getCurrentVideoPath: () => Promise<{ success: boolean; path?: string }>;
		getCurrentRecordingSession: () => Promise<{
			success: boolean;
			session?: import("../src/lib/recordingSession").RecordingSession;
		}>;
		readBinaryFile: (filePath: string) => Promise<{
			success: boolean;
			data?: ArrayBuffer;
			path?: string;
			message?: string;
			error?: string;
		}>;
		clearCurrentVideoPath: () => Promise<{ success: boolean }>;
		saveProjectFile: (
			projectData: unknown,
			suggestedName?: string,
			existingProjectPath?: string,
		) => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			canceled?: boolean;
			error?: string;
		}>;
		loadProjectFile: () => Promise<{
			success: boolean;
			path?: string;
			project?: unknown;
			message?: string;
			canceled?: boolean;
			error?: string;
		}>;
		loadCurrentProjectFile: () => Promise<{
			success: boolean;
			path?: string;
			project?: unknown;
			message?: string;
			canceled?: boolean;
			error?: string;
		}>;
		onMenuLoadProject: (callback: () => void) => () => void;
		onMenuSaveProject: (callback: () => void) => () => void;
		onMenuSaveProjectAs: (callback: () => void) => () => void;
		getPlatform: () => Promise<string>;
		revealInFolder: (
			filePath: string,
		) => Promise<{ success: boolean; error?: string; message?: string }>;
		getShortcuts: () => Promise<Record<string, unknown> | null>;
		saveShortcuts: (shortcuts: unknown) => Promise<{ success: boolean; error?: string }>;
		hudOverlayHide: () => void;
		hudOverlayClose: () => void;
		showCountdownOverlay: (value: number, runId: number) => Promise<void>;
		setCountdownOverlayValue: (value: number, runId: number) => Promise<void>;
		hideCountdownOverlay: (runId: number) => Promise<void>;
		onCountdownOverlayValue: (callback: (value: number | null) => void) => () => void;
		setMicrophoneExpanded: (expanded: boolean) => void;
		setHasUnsavedChanges: (hasChanges: boolean) => void;
		onRequestSaveBeforeClose: (callback: () => Promise<boolean> | boolean) => () => void;
		setLocale: (locale: string) => Promise<void>;
		getMcpServerStatus: () => Promise<{
			running?: boolean;
			url?: string;
			host?: string;
			port?: number;
			path?: string;
			startedAt?: string;
			sessionCount?: number;
			authRequired?: boolean;
			error?: string | null;
		}>;
		createTerminal: (options: {
			sessionId: string;
			cols: number;
			rows: number;
			mode?: "shell";
		}) => Promise<{
			success: boolean;
			sessionId?: string;
			pid?: number;
			mode?: "shell";
			cwd?: string;
			shell?: string;
			mcpClientConfig?: McpClientConfigInfo;
			error?: string;
		}>;
		getMcpClientConfig: () => Promise<McpClientConfigInfo>;
		writeTerminal: (sessionId: string, data: string) => void;
		resizeTerminal: (sessionId: string, cols: number, rows: number) => void;
		killTerminal: (sessionId: string) => void;
		onTerminalData: (sessionId: string, callback: (data: string) => void) => () => void;
		onTerminalExit: (
			sessionId: string,
			callback: (event: { exitCode: number; signal?: number }) => void,
		) => () => void;
		onMcpCommand: (
			target: "hud" | "editor",
			callback: (method: string, args: unknown) => Promise<unknown> | unknown,
		) => () => void;
		notifyMcpTargetReady: (target: "hud" | "editor") => void;
	};
}

interface ProcessedDesktopSource {
	id: string;
	name: string;
	display_id: string;
	thumbnail: string | null;
	appIcon: string | null;
}

interface CursorTelemetryPoint {
	timeMs: number;
	cx: number;
	cy: number;
}

interface McpClientConfigWriteResult {
	success: boolean;
	path: string;
	snippet: string;
	manualCommands: string[];
	error?: string;
}

interface McpClientConfigInfo {
	projectRoot: string;
	serverName: string;
	endpoint: string;
	authRequired: boolean;
	tokenEnvVar: string;
	codex: McpClientConfigWriteResult;
	claude: McpClientConfigWriteResult;
}
