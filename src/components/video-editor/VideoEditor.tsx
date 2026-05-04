import type { Span } from "dnd-timeline";
import { FolderOpen, Languages, Save, Video } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { toast } from "sonner";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useI18n, useScopedT } from "@/contexts/I18nContext";
import { useShortcuts } from "@/contexts/ShortcutsContext";
import { INITIAL_EDITOR_STATE, useEditorHistory } from "@/hooks/useEditorHistory";
import { type Locale } from "@/i18n/config";
import { getAvailableLocales, getLocaleName } from "@/i18n/loader";
import { addCustomFont, getCustomFonts, removeCustomFont } from "@/lib/customFonts";
import {
	calculateOutputDimensions,
	type ExportFormat,
	type ExportProgress,
	type ExportQuality,
	type ExportSettings,
	GIF_SIZE_PRESETS,
	GifExporter,
	type GifFrameRate,
	type GifSizePreset,
	VideoExporter,
} from "@/lib/exporter";
import { computeFrameStepTime } from "@/lib/frameStep";
import type { ProjectMedia } from "@/lib/recordingSession";
import { matchesShortcut, type ShortcutsConfig } from "@/lib/shortcuts";
import { loadUserPreferences, saveUserPreferences } from "@/lib/userPreferences";
import { BackgroundLoadError } from "@/lib/wallpaper";
import {
	getAspectRatioValue,
	getNativeAspectRatioValue,
	isPortraitAspectRatio,
} from "@/utils/aspectRatioUtils";
import { ExportDialog } from "./ExportDialog";
import PlaybackControls from "./PlaybackControls";
import {
	createProjectData,
	createProjectSnapshot,
	deriveNextId,
	fromFileUrl,
	hasProjectUnsavedChanges,
	normalizeProjectEditor,
	resolveProjectMedia,
	toFileUrl,
	validateProjectData,
} from "./projectPersistence";
import { SettingsPanel } from "./SettingsPanel";
import TimelineEditor from "./timeline/TimelineEditor";
import {
	type AnnotationRegion,
	type BlurData,
	type CursorTelemetryPoint,
	clampFocusToDepth,
	DEFAULT_ANNOTATION_POSITION,
	DEFAULT_ANNOTATION_SIZE,
	DEFAULT_ANNOTATION_STYLE,
	DEFAULT_BLUR_DATA,
	DEFAULT_CROP_REGION,
	DEFAULT_FIGURE_DATA,
	DEFAULT_PLAYBACK_SPEED,
	DEFAULT_ZOOM_DEPTH,
	type FigureData,
	type PlaybackSpeed,
	type Rotation3DPreset,
	type SpeedRegion,
	type TrimRegion,
	type ZoomDepth,
	type ZoomFocus,
	type ZoomFocusMode,
	type ZoomRegion,
} from "./types";
import VideoPlayback, { VideoPlaybackRef } from "./VideoPlayback";

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function finiteNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown): boolean | null {
	return typeof value === "boolean" ? value : null;
}

function clampNumber(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function omitUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
	return Object.fromEntries(
		Object.entries(value).filter((entry) => entry[1] !== undefined),
	) as Partial<T>;
}

export default function VideoEditor() {
	const {
		state: editorState,
		pushState,
		updateState,
		commitState,
		undo,
		redo,
	} = useEditorHistory(INITIAL_EDITOR_STATE);

	const {
		zoomRegions,
		trimRegions,
		speedRegions,
		annotationRegions,
		cropRegion,
		wallpaper,
		shadowIntensity,
		showBlur,
		motionBlurAmount,
		borderRadius,
		padding,
		aspectRatio,
		webcamLayoutPreset,
		webcamMaskShape,
		webcamSizePreset,
		webcamPosition,
		cursorHighlight,
	} = editorState;

	// ── Non-undoable state
	const [videoPath, setVideoPath] = useState<string | null>(null);
	const [videoSourcePath, setVideoSourcePath] = useState<string | null>(null);
	const [webcamVideoPath, setWebcamVideoPath] = useState<string | null>(null);
	const [webcamVideoSourcePath, setWebcamVideoSourcePath] = useState<string | null>(null);
	const [currentProjectPath, setCurrentProjectPath] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [isPlaying, setIsPlaying] = useState(false);
	const [currentTime, setCurrentTime] = useState(0);
	const [duration, setDuration] = useState(0);
	const currentTimeRef = useRef(currentTime);
	currentTimeRef.current = currentTime;
	const durationRef = useRef(duration);
	durationRef.current = duration;
	const [cursorTelemetry, setCursorTelemetry] = useState<CursorTelemetryPoint[]>([]);
	const [cursorClickTimestamps, setCursorClickTimestamps] = useState<number[]>([]);
	const [selectedZoomId, setSelectedZoomId] = useState<string | null>(null);
	const [selectedTrimId, setSelectedTrimId] = useState<string | null>(null);
	const [selectedSpeedId, setSelectedSpeedId] = useState<string | null>(null);
	const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
	const [selectedBlurId, setSelectedBlurId] = useState<string | null>(null);
	const [isExporting, setIsExporting] = useState(false);
	const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
	const [exportError, setExportError] = useState<string | null>(null);
	const [showExportDialog, setShowExportDialog] = useState(false);
	const [showNewRecordingDialog, setShowNewRecordingDialog] = useState(false);
	const [exportQuality, setExportQuality] = useState<ExportQuality>("good");
	const [exportFormat, setExportFormat] = useState<ExportFormat>("mp4");
	const [gifFrameRate, setGifFrameRate] = useState<GifFrameRate>(15);
	const [gifLoop, setGifLoop] = useState(true);
	const [gifSizePreset, setGifSizePreset] = useState<GifSizePreset>("medium");
	const [exportedFilePath, setExportedFilePath] = useState<string | null>(null);
	const [lastSavedSnapshot, setLastSavedSnapshot] = useState<string | null>(null);
	const [unsavedExport, setUnsavedExport] = useState<{
		arrayBuffer: ArrayBuffer;
		fileName: string;
		format: string;
	} | null>(null);
	const [isFullscreen, setIsFullscreen] = useState(false);

	const playerContainerRef = useRef<HTMLDivElement>(null);
	const videoPlaybackRef = useRef<VideoPlaybackRef>(null);

	const nextZoomIdRef = useRef(1);
	const nextTrimIdRef = useRef(1);
	const nextSpeedIdRef = useRef(1);

	const { shortcuts, isMac, setShortcuts } = useShortcuts();
	// Off-Mac doesn't have click telemetry, so force `onlyOnClicks` off for
	// renderers while keeping the persisted value intact for round-tripping.
	const effectiveCursorHighlight = useMemo(
		() => (isMac ? cursorHighlight : { ...cursorHighlight, onlyOnClicks: false }),
		[cursorHighlight, isMac],
	);
	const { locale, setLocale, t: rawT } = useI18n();
	const t = useScopedT("editor");
	const ts = useScopedT("settings");
	const availableLocales = getAvailableLocales();

	const nextAnnotationIdRef = useRef(1);
	const nextAnnotationZIndexRef = useRef(1);
	const exporterRef = useRef<VideoExporter | null>(null);

	const annotationOnlyRegions = useMemo(
		() => annotationRegions.filter((region) => region.type !== "blur"),
		[annotationRegions],
	);
	const blurRegions = useMemo(
		() => annotationRegions.filter((region) => region.type === "blur"),
		[annotationRegions],
	);

	const currentProjectMedia = useMemo<ProjectMedia | null>(() => {
		const screenVideoPath = videoSourcePath ?? (videoPath ? fromFileUrl(videoPath) : null);
		if (!screenVideoPath) {
			return null;
		}

		const webcamSourcePath =
			webcamVideoSourcePath ?? (webcamVideoPath ? fromFileUrl(webcamVideoPath) : null);
		return webcamSourcePath
			? { screenVideoPath, webcamVideoPath: webcamSourcePath }
			: { screenVideoPath };
	}, [videoPath, videoSourcePath, webcamVideoPath, webcamVideoSourcePath]);

	const applyLoadedProject = useCallback(
		async (candidate: unknown, path?: string | null) => {
			if (!validateProjectData(candidate)) {
				return false;
			}

			const project = candidate;
			const media = resolveProjectMedia(project);
			if (!media) {
				return false;
			}
			const sourcePath = fromFileUrl(media.screenVideoPath);
			const webcamSourcePath = media.webcamVideoPath ? fromFileUrl(media.webcamVideoPath) : null;
			const normalizedEditor = normalizeProjectEditor(project.editor);

			try {
				videoPlaybackRef.current?.pause();
			} catch {
				// no-op
			}
			setIsPlaying(false);
			setCurrentTime(0);
			setDuration(0);

			setError(null);
			setVideoSourcePath(sourcePath);
			setVideoPath(toFileUrl(sourcePath));
			setWebcamVideoSourcePath(webcamSourcePath);
			setWebcamVideoPath(webcamSourcePath ? toFileUrl(webcamSourcePath) : null);
			setCurrentProjectPath(path ?? null);

			pushState({
				wallpaper: normalizedEditor.wallpaper,
				shadowIntensity: normalizedEditor.shadowIntensity,
				showBlur: normalizedEditor.showBlur,
				motionBlurAmount: normalizedEditor.motionBlurAmount,
				borderRadius: normalizedEditor.borderRadius,
				padding: normalizedEditor.padding,
				cropRegion: normalizedEditor.cropRegion,
				zoomRegions: normalizedEditor.zoomRegions,
				trimRegions: normalizedEditor.trimRegions,
				speedRegions: normalizedEditor.speedRegions,
				annotationRegions: normalizedEditor.annotationRegions,
				aspectRatio: normalizedEditor.aspectRatio,
				webcamLayoutPreset: normalizedEditor.webcamLayoutPreset,
				webcamMaskShape: normalizedEditor.webcamMaskShape,
				webcamSizePreset: normalizedEditor.webcamSizePreset,
				webcamPosition: normalizedEditor.webcamPosition,
				cursorHighlight: normalizedEditor.cursorHighlight,
			});
			setExportQuality(normalizedEditor.exportQuality);
			setExportFormat(normalizedEditor.exportFormat);
			setGifFrameRate(normalizedEditor.gifFrameRate);
			setGifLoop(normalizedEditor.gifLoop);
			setGifSizePreset(normalizedEditor.gifSizePreset);

			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedSpeedId(null);
			setSelectedAnnotationId(null);
			setSelectedBlurId(null);

			nextZoomIdRef.current = deriveNextId(
				"zoom",
				normalizedEditor.zoomRegions.map((region) => region.id),
			);
			nextTrimIdRef.current = deriveNextId(
				"trim",
				normalizedEditor.trimRegions.map((region) => region.id),
			);
			nextSpeedIdRef.current = deriveNextId(
				"speed",
				normalizedEditor.speedRegions.map((region) => region.id),
			);
			nextAnnotationIdRef.current = deriveNextId(
				"annotation",
				normalizedEditor.annotationRegions.map((region) => region.id),
			);
			nextAnnotationZIndexRef.current =
				normalizedEditor.annotationRegions.reduce(
					(max, region) => Math.max(max, region.zIndex),
					0,
				) + 1;

			setLastSavedSnapshot(
				createProjectSnapshot(
					webcamSourcePath
						? { screenVideoPath: sourcePath, webcamVideoPath: webcamSourcePath }
						: { screenVideoPath: sourcePath },
					normalizedEditor,
				),
			);
			return true;
		},
		[pushState],
	);

	const currentProjectSnapshot = useMemo(() => {
		if (!currentProjectMedia) {
			return null;
		}
		return createProjectSnapshot(currentProjectMedia, {
			wallpaper,
			shadowIntensity,
			showBlur,
			motionBlurAmount,
			borderRadius,
			padding,
			cropRegion,
			zoomRegions,
			trimRegions,
			speedRegions,
			annotationRegions,
			aspectRatio,
			webcamLayoutPreset,
			webcamMaskShape,
			webcamSizePreset,
			webcamPosition,
			exportQuality,
			exportFormat,
			gifFrameRate,
			gifLoop,
			gifSizePreset,
			cursorHighlight,
		});
	}, [
		currentProjectMedia,
		wallpaper,
		shadowIntensity,
		showBlur,
		motionBlurAmount,
		borderRadius,
		padding,
		cropRegion,
		zoomRegions,
		trimRegions,
		speedRegions,
		annotationRegions,
		aspectRatio,
		webcamLayoutPreset,
		webcamMaskShape,
		webcamSizePreset,
		webcamPosition,
		exportQuality,
		exportFormat,
		gifFrameRate,
		gifLoop,
		gifSizePreset,
		cursorHighlight,
	]);

	const hasUnsavedChanges = hasProjectUnsavedChanges(currentProjectSnapshot, lastSavedSnapshot);

	useEffect(() => {
		async function loadInitialData() {
			try {
				const currentProjectResult = await window.electronAPI.loadCurrentProjectFile();
				if (currentProjectResult.success && currentProjectResult.project) {
					const restored = await applyLoadedProject(
						currentProjectResult.project,
						currentProjectResult.path ?? null,
					);
					if (restored) {
						return;
					}
				}

				const currentSessionResult = await window.electronAPI.getCurrentRecordingSession();
				if (currentSessionResult.success && currentSessionResult.session) {
					const session = currentSessionResult.session;
					const sourcePath = fromFileUrl(session.screenVideoPath);
					const webcamSourcePath = session.webcamVideoPath
						? fromFileUrl(session.webcamVideoPath)
						: null;
					setVideoSourcePath(sourcePath);
					setVideoPath(toFileUrl(sourcePath));
					setWebcamVideoSourcePath(webcamSourcePath);
					setWebcamVideoPath(webcamSourcePath ? toFileUrl(webcamSourcePath) : null);
					setCurrentProjectPath(null);
					setLastSavedSnapshot(
						createProjectSnapshot(
							webcamSourcePath
								? {
										screenVideoPath: sourcePath,
										webcamVideoPath: webcamSourcePath,
									}
								: { screenVideoPath: sourcePath },
							INITIAL_EDITOR_STATE,
						),
					);
					return;
				}

				const result = await window.electronAPI.getCurrentVideoPath();
				if (result.success && result.path) {
					const sourcePath = fromFileUrl(result.path);
					setVideoSourcePath(sourcePath);
					setVideoPath(toFileUrl(sourcePath));
					setWebcamVideoSourcePath(null);
					setWebcamVideoPath(null);
					setCurrentProjectPath(null);
					setLastSavedSnapshot(
						createProjectSnapshot({ screenVideoPath: sourcePath }, INITIAL_EDITOR_STATE),
					);
				} else {
					setError("No video to load. Please record or select a video.");
				}
			} catch (err) {
				setError("Error loading video: " + String(err));
			} finally {
				setLoading(false);
			}
		}

		loadInitialData();
	}, [applyLoadedProject]);

	// Track whether user preferences have been loaded to avoid
	// overwriting saved prefs with defaults on the first render
	const [prefsHydrated, setPrefsHydrated] = useState(false);

	// Load persisted user preferences on mount (intentionally runs once)
	useEffect(() => {
		const prefs = loadUserPreferences();
		updateState({
			padding: prefs.padding,
			aspectRatio: prefs.aspectRatio,
		});
		setExportQuality(prefs.exportQuality);
		setExportFormat(prefs.exportFormat);
		setPrefsHydrated(true);
	}, [updateState]);

	// Auto-save user preferences when settings change
	useEffect(() => {
		if (!prefsHydrated) return;
		saveUserPreferences({ padding, aspectRatio, exportQuality, exportFormat });
	}, [prefsHydrated, padding, aspectRatio, exportQuality, exportFormat]);

	const saveProject = useCallback(
		async (forceSaveAs: boolean) => {
			if (!videoPath) {
				toast.error(t("errors.noVideoLoaded"));
				return false;
			}

			if (!currentProjectMedia) {
				toast.error(t("errors.unableToDetermineSourcePath"));
				return false;
			}

			const editorState = {
				wallpaper,
				shadowIntensity,
				showBlur,
				motionBlurAmount,
				borderRadius,
				padding,
				cropRegion,
				zoomRegions,
				trimRegions,
				speedRegions,
				annotationRegions,
				aspectRatio,
				webcamLayoutPreset,
				webcamMaskShape,
				webcamSizePreset,
				webcamPosition,
				exportQuality,
				exportFormat,
				gifFrameRate,
				gifLoop,
				gifSizePreset,
				cursorHighlight,
			};
			const projectData = createProjectData(currentProjectMedia, editorState);

			const fileNameBase =
				currentProjectMedia.screenVideoPath
					.split(/[\\/]/)
					.pop()
					?.replace(/\.[^.]+$/, "") || `project-${Date.now()}`;
			// Match the normalization path used by `currentProjectSnapshot` so the
			// post-save baseline compares equal and `hasUnsavedChanges` clears.
			const projectSnapshot = createProjectSnapshot(currentProjectMedia, editorState);
			const result = await window.electronAPI.saveProjectFile(
				projectData,
				fileNameBase,
				forceSaveAs ? undefined : (currentProjectPath ?? undefined),
			);

			if (result.canceled) {
				toast.info(t("project.saveCanceled"));
				return false;
			}

			if (!result.success) {
				toast.error(result.message || t("project.failedToSave"));
				return false;
			}

			if (result.path) {
				setCurrentProjectPath(result.path);
			}
			setLastSavedSnapshot(projectSnapshot);

			toast.success(t("project.savedTo", { path: result.path ?? "" }));
			return true;
		},
		[
			currentProjectMedia,
			currentProjectPath,
			wallpaper,
			shadowIntensity,
			showBlur,
			motionBlurAmount,
			borderRadius,
			padding,
			cropRegion,
			zoomRegions,
			trimRegions,
			speedRegions,
			annotationRegions,
			aspectRatio,
			webcamLayoutPreset,
			webcamMaskShape,
			webcamPosition,
			exportQuality,
			exportFormat,
			gifFrameRate,
			gifLoop,
			gifSizePreset,
			videoPath,
			t,
			webcamSizePreset,
			cursorHighlight,
		],
	);

	useEffect(() => {
		window.electronAPI.setHasUnsavedChanges(hasUnsavedChanges);
	}, [hasUnsavedChanges]);

	useEffect(() => {
		const cleanup = window.electronAPI.onRequestSaveBeforeClose(async () => {
			return saveProject(false);
		});
		return () => cleanup();
	}, [saveProject]);

	const handleSaveProject = useCallback(async () => {
		await saveProject(false);
	}, [saveProject]);

	const handleSaveProjectAs = useCallback(async () => {
		await saveProject(true);
	}, [saveProject]);

	const handleNewRecordingConfirm = useCallback(async () => {
		const result = await window.electronAPI.startNewRecording();
		if (result.success) {
			setShowNewRecordingDialog(false);
		} else {
			console.error("Failed to start new recording:", result.error);
			setError("Failed to start new recording: " + (result.error || "Unknown error"));
		}
	}, []);

	const handleLoadProject = useCallback(async () => {
		const result = await window.electronAPI.loadProjectFile();

		if (result.canceled) {
			return;
		}

		if (!result.success) {
			toast.error(result.message || t("project.failedToLoad"));
			return;
		}

		const restored = await applyLoadedProject(result.project, result.path ?? null);
		if (!restored) {
			toast.error(t("project.invalidFormat"));
			return;
		}

		toast.success(t("project.loadedFrom", { path: result.path ?? "" }));
	}, [applyLoadedProject, t]);

	useEffect(() => {
		const removeLoadListener = window.electronAPI.onMenuLoadProject(handleLoadProject);
		const removeSaveListener = window.electronAPI.onMenuSaveProject(handleSaveProject);
		const removeSaveAsListener = window.electronAPI.onMenuSaveProjectAs(handleSaveProjectAs);

		return () => {
			removeLoadListener?.();
			removeSaveListener?.();
			removeSaveAsListener?.();
		};
	}, [handleLoadProject, handleSaveProject, handleSaveProjectAs]);

	useEffect(() => {
		let mounted = true;

		async function loadCursorTelemetry() {
			const sourcePath = currentProjectMedia?.screenVideoPath ?? null;

			if (!sourcePath) {
				if (mounted) {
					setCursorTelemetry([]);
					setCursorClickTimestamps([]);
				}
				return;
			}

			try {
				const result = await window.electronAPI.getCursorTelemetry(sourcePath);
				if (mounted) {
					setCursorTelemetry(result.success ? result.samples : []);
					setCursorClickTimestamps(result.success ? (result.clicks ?? []) : []);
				}
			} catch (telemetryError) {
				console.warn("Unable to load cursor telemetry:", telemetryError);
				if (mounted) {
					setCursorTelemetry([]);
					setCursorClickTimestamps([]);
				}
			}
		}

		loadCursorTelemetry();

		return () => {
			mounted = false;
		};
	}, [currentProjectMedia]);

	function togglePlayPause() {
		const playback = videoPlaybackRef.current;
		const video = playback?.video;
		if (!playback || !video) return;

		if (isPlaying) {
			playback.pause();
		} else {
			playback.play().catch((err) => console.error("Video play failed:", err));
		}
	}

	const toggleFullscreen = useCallback(() => {
		setIsFullscreen((prev) => !prev);
	}, []);

	useEffect(() => {
		if (!isFullscreen) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				setIsFullscreen(false);
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isFullscreen]);

	function handleSeek(time: number) {
		const video = videoPlaybackRef.current?.video;
		if (!video) return;
		video.currentTime = time;
	}

	const handleSelectZoom = useCallback((id: string | null) => {
		setSelectedZoomId(id);
		if (id) {
			setSelectedTrimId(null);
			setSelectedAnnotationId(null);
			setSelectedBlurId(null);
		}
	}, []);

	const handleSelectTrim = useCallback((id: string | null) => {
		setSelectedTrimId(id);
		if (id) {
			setSelectedZoomId(null);
			setSelectedAnnotationId(null);
			setSelectedBlurId(null);
		}
	}, []);

	const handleSelectAnnotation = useCallback((id: string | null) => {
		setSelectedAnnotationId(id);
		if (id) {
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedBlurId(null);
		}
	}, []);

	const handleSelectBlur = useCallback((id: string | null) => {
		setSelectedBlurId(id);
		if (id) {
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedAnnotationId(null);
			setSelectedSpeedId(null);
		}
	}, []);

	const handleZoomAdded = useCallback(
		(span: Span) => {
			const id = `zoom-${nextZoomIdRef.current++}`;
			const newRegion: ZoomRegion = {
				id,
				startMs: Math.round(span.start),
				endMs: Math.round(span.end),
				depth: DEFAULT_ZOOM_DEPTH,
				focus: { cx: 0.5, cy: 0.5 },
			};
			pushState((prev) => ({ zoomRegions: [...prev.zoomRegions, newRegion] }));
			setSelectedZoomId(id);
			setSelectedTrimId(null);
			setSelectedAnnotationId(null);
			setSelectedBlurId(null);
		},
		[pushState],
	);

	const handleZoomSuggested = useCallback(
		(span: Span, focus: ZoomFocus) => {
			const id = `zoom-${nextZoomIdRef.current++}`;
			const newRegion: ZoomRegion = {
				id,
				startMs: Math.round(span.start),
				endMs: Math.round(span.end),
				depth: DEFAULT_ZOOM_DEPTH,
				focus: clampFocusToDepth(focus, DEFAULT_ZOOM_DEPTH),
			};
			pushState((prev) => ({ zoomRegions: [...prev.zoomRegions, newRegion] }));
			setSelectedZoomId(id);
			setSelectedTrimId(null);
			setSelectedAnnotationId(null);
			setSelectedBlurId(null);
		},
		[pushState],
	);

	const handleTrimAdded = useCallback(
		(span: Span) => {
			const id = `trim-${nextTrimIdRef.current++}`;
			const newRegion: TrimRegion = {
				id,
				startMs: Math.round(span.start),
				endMs: Math.round(span.end),
			};
			pushState((prev) => ({ trimRegions: [...prev.trimRegions, newRegion] }));
			setSelectedTrimId(id);
			setSelectedZoomId(null);
			setSelectedAnnotationId(null);
			setSelectedBlurId(null);
		},
		[pushState],
	);

	const handleZoomSpanChange = useCallback(
		(id: string, span: Span) => {
			pushState((prev) => ({
				zoomRegions: prev.zoomRegions.map((region) =>
					region.id === id
						? {
								...region,
								startMs: Math.round(span.start),
								endMs: Math.round(span.end),
							}
						: region,
				),
			}));
		},
		[pushState],
	);

	const handleTrimSpanChange = useCallback(
		(id: string, span: Span) => {
			pushState((prev) => ({
				trimRegions: prev.trimRegions.map((region) =>
					region.id === id
						? {
								...region,
								startMs: Math.round(span.start),
								endMs: Math.round(span.end),
							}
						: region,
				),
			}));
		},
		[pushState],
	);

	// Focus drag: updateState for live preview, commitState on pointer-up
	const handleZoomFocusChange = useCallback(
		(id: string, focus: ZoomFocus) => {
			updateState((prev) => ({
				zoomRegions: prev.zoomRegions.map((region) =>
					region.id === id ? { ...region, focus: clampFocusToDepth(focus, region.depth) } : region,
				),
			}));
		},
		[updateState],
	);

	const handleZoomDepthChange = useCallback(
		(depth: ZoomDepth) => {
			if (!selectedZoomId) return;
			pushState((prev) => ({
				zoomRegions: prev.zoomRegions.map((region) =>
					region.id === selectedZoomId
						? {
								...region,
								depth,
								focus: clampFocusToDepth(region.focus, depth),
							}
						: region,
				),
			}));
		},
		[selectedZoomId, pushState],
	);

	const handleZoomFocusModeChange = useCallback(
		(focusMode: ZoomFocusMode) => {
			if (!selectedZoomId) return;
			pushState((prev) => ({
				zoomRegions: prev.zoomRegions.map((region) =>
					region.id === selectedZoomId ? { ...region, focusMode } : region,
				),
			}));
		},
		[selectedZoomId, pushState],
	);

	const handleZoomDelete = useCallback(
		(id: string) => {
			pushState((prev) => ({
				zoomRegions: prev.zoomRegions.filter((r) => r.id !== id),
			}));
			if (selectedZoomId === id) {
				setSelectedZoomId(null);
			}
		},
		[selectedZoomId, pushState],
	);

	const handleZoomRotationPresetChange = useCallback(
		(preset: Rotation3DPreset | null) => {
			if (!selectedZoomId) return;
			pushState((prev) => ({
				zoomRegions: prev.zoomRegions.map((region) => {
					if (region.id !== selectedZoomId) return region;
					if (preset === null) {
						const { rotationPreset: _p, ...rest } = region;
						return rest;
					}
					return { ...region, rotationPreset: preset };
				}),
			}));
		},
		[selectedZoomId, pushState],
	);

	const handleTrimDelete = useCallback(
		(id: string) => {
			pushState((prev) => ({
				trimRegions: prev.trimRegions.filter((r) => r.id !== id),
			}));
			if (selectedTrimId === id) {
				setSelectedTrimId(null);
			}
		},
		[selectedTrimId, pushState],
	);

	const handleSelectSpeed = useCallback((id: string | null) => {
		setSelectedSpeedId(id);
		if (id) {
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedAnnotationId(null);
			setSelectedBlurId(null);
		}
	}, []);

	const handleSpeedAdded = useCallback(
		(span: Span) => {
			const id = `speed-${nextSpeedIdRef.current++}`;
			const newRegion: SpeedRegion = {
				id,
				startMs: Math.round(span.start),
				endMs: Math.round(span.end),
				speed: DEFAULT_PLAYBACK_SPEED,
			};
			pushState((prev) => ({
				speedRegions: [...prev.speedRegions, newRegion],
			}));
			setSelectedSpeedId(id);
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedAnnotationId(null);
			setSelectedBlurId(null);
		},
		[pushState],
	);

	const handleSpeedSpanChange = useCallback(
		(id: string, span: Span) => {
			pushState((prev) => ({
				speedRegions: prev.speedRegions.map((region) =>
					region.id === id
						? {
								...region,
								startMs: Math.round(span.start),
								endMs: Math.round(span.end),
							}
						: region,
				),
			}));
		},
		[pushState],
	);

	const handleSpeedDelete = useCallback(
		(id: string) => {
			pushState((prev) => ({
				speedRegions: prev.speedRegions.filter((region) => region.id !== id),
			}));
			if (selectedSpeedId === id) {
				setSelectedSpeedId(null);
			}
		},
		[selectedSpeedId, pushState],
	);

	const handleSpeedChange = useCallback(
		(speed: PlaybackSpeed) => {
			if (!selectedSpeedId) return;
			pushState((prev) => ({
				speedRegions: prev.speedRegions.map((region) =>
					region.id === selectedSpeedId ? { ...region, speed } : region,
				),
			}));
		},
		[selectedSpeedId, pushState],
	);

	const handleAnnotationAdded = useCallback(
		(span: Span) => {
			const id = `annotation-${nextAnnotationIdRef.current++}`;
			const zIndex = nextAnnotationZIndexRef.current++;
			const newRegion: AnnotationRegion = {
				id,
				startMs: Math.round(span.start),
				endMs: Math.round(span.end),
				type: "text",
				content: "Enter text...",
				position: { ...DEFAULT_ANNOTATION_POSITION },
				size: { ...DEFAULT_ANNOTATION_SIZE },
				style: { ...DEFAULT_ANNOTATION_STYLE },
				zIndex,
			};
			pushState((prev) => ({
				annotationRegions: [...prev.annotationRegions, newRegion],
			}));
			setSelectedAnnotationId(id);
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedBlurId(null);
		},
		[pushState],
	);

	const handleBlurAdded = useCallback(
		(span: Span) => {
			const id = `annotation-${nextAnnotationIdRef.current++}`;
			const zIndex = nextAnnotationZIndexRef.current++;
			const newRegion: AnnotationRegion = {
				id,
				startMs: Math.round(span.start),
				endMs: Math.round(span.end),
				type: "blur",
				content: "",
				position: { ...DEFAULT_ANNOTATION_POSITION },
				size: { ...DEFAULT_ANNOTATION_SIZE },
				style: { ...DEFAULT_ANNOTATION_STYLE },
				zIndex,
				blurData: { ...DEFAULT_BLUR_DATA },
			};
			pushState((prev) => ({
				annotationRegions: [...prev.annotationRegions, newRegion],
			}));
			setSelectedBlurId(id);
			setSelectedAnnotationId(null);
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedSpeedId(null);
		},
		[pushState],
	);

	const handleAnnotationSpanChange = useCallback(
		(id: string, span: Span) => {
			pushState((prev) => ({
				annotationRegions: prev.annotationRegions.map((region) =>
					region.id === id
						? {
								...region,
								startMs: Math.round(span.start),
								endMs: Math.round(span.end),
							}
						: region,
				),
			}));
		},
		[pushState],
	);

	const handleAnnotationDuplicate = useCallback(
		(id: string) => {
			const duplicateId = `annotation-${nextAnnotationIdRef.current++}`;
			const duplicateZIndex = nextAnnotationZIndexRef.current++;
			pushState((prev) => {
				const source = prev.annotationRegions.find((region) => region.id === id);
				if (!source) return {};

				const duplicate: AnnotationRegion = {
					...source,
					id: duplicateId,
					zIndex: duplicateZIndex,
					position: { x: source.position.x + 4, y: source.position.y + 4 },
					size: { ...source.size },
					style: { ...source.style },
					figureData: source.figureData ? { ...source.figureData } : undefined,
				};

				return { annotationRegions: [...prev.annotationRegions, duplicate] };
			});
			setSelectedAnnotationId(duplicateId);
			setSelectedZoomId(null);
			setSelectedTrimId(null);
		},
		[pushState],
	);

	const handleAnnotationDelete = useCallback(
		(id: string) => {
			pushState((prev) => ({
				annotationRegions: prev.annotationRegions.filter((r) => r.id !== id),
			}));
			if (selectedAnnotationId === id) {
				setSelectedAnnotationId(null);
			}
			if (selectedBlurId === id) {
				setSelectedBlurId(null);
			}
		},
		[selectedAnnotationId, selectedBlurId, pushState],
	);

	const handleAnnotationContentChange = useCallback(
		(id: string, content: string) => {
			pushState((prev) => ({
				annotationRegions: prev.annotationRegions.map((region) => {
					if (region.id !== id) return region;
					if (region.type === "text") {
						return { ...region, content, textContent: content };
					} else if (region.type === "image") {
						return { ...region, content, imageContent: content };
					}
					return { ...region, content };
				}),
			}));
		},
		[pushState],
	);

	const handleAnnotationTypeChange = useCallback(
		(id: string, type: AnnotationRegion["type"]) => {
			pushState((prev) => ({
				annotationRegions: prev.annotationRegions.map((region) => {
					if (region.id !== id) return region;
					const updatedRegion = { ...region, type };
					if (type === "text") {
						updatedRegion.content = region.textContent || "Enter text...";
					} else if (type === "image") {
						updatedRegion.content = region.imageContent || "";
					} else if (type === "figure") {
						updatedRegion.content = "";
						if (!region.figureData) {
							updatedRegion.figureData = { ...DEFAULT_FIGURE_DATA };
						}
					} else if (type === "blur") {
						updatedRegion.content = "";
						if (!region.blurData) {
							updatedRegion.blurData = { ...DEFAULT_BLUR_DATA };
						}
					}
					return updatedRegion;
				}),
			}));

			if (type === "blur" && selectedAnnotationId === id) {
				setSelectedAnnotationId(null);
				setSelectedBlurId(id);
				setSelectedSpeedId(null);
			} else if (type !== "blur" && selectedBlurId === id) {
				setSelectedBlurId(null);
				setSelectedAnnotationId(id);
			}
		},
		[pushState, selectedAnnotationId, selectedBlurId],
	);

	const handleAnnotationStyleChange = useCallback(
		(id: string, style: Partial<AnnotationRegion["style"]>) => {
			pushState((prev) => ({
				annotationRegions: prev.annotationRegions.map((region) =>
					region.id === id ? { ...region, style: { ...region.style, ...style } } : region,
				),
			}));
		},
		[pushState],
	);

	const handleAnnotationFigureDataChange = useCallback(
		(id: string, figureData: FigureData) => {
			pushState((prev) => ({
				annotationRegions: prev.annotationRegions.map((region) =>
					region.id === id ? { ...region, figureData } : region,
				),
			}));
		},
		[pushState],
	);

	const handleBlurDataPreviewChange = useCallback(
		(id: string, blurData: BlurData) => {
			updateState((prev) => ({
				annotationRegions: prev.annotationRegions.map((region) =>
					region.id === id
						? {
								...region,
								blurData,
								// Freehand drawing area is the full video surface.
								...(blurData.shape === "freehand"
									? {
											position: { x: 0, y: 0 },
											size: { width: 100, height: 100 },
										}
									: {}),
							}
						: region,
				),
			}));
		},
		[updateState],
	);

	const handleBlurDataPanelChange = useCallback(
		(id: string, blurData: BlurData) => {
			pushState((prev) => ({
				annotationRegions: prev.annotationRegions.map((region) =>
					region.id === id
						? {
								...region,
								blurData,
								...(blurData.shape === "freehand"
									? {
											position: { x: 0, y: 0 },
											size: { width: 100, height: 100 },
										}
									: {}),
							}
						: region,
				),
			}));
		},
		[pushState],
	);

	const handleAnnotationPositionChange = useCallback(
		(id: string, position: { x: number; y: number }) => {
			pushState((prev) => ({
				annotationRegions: prev.annotationRegions.map((region) =>
					region.id === id ? { ...region, position } : region,
				),
			}));
		},
		[pushState],
	);

	const handleAnnotationSizeChange = useCallback(
		(id: string, size: { width: number; height: number }) => {
			pushState((prev) => ({
				annotationRegions: prev.annotationRegions.map((region) =>
					region.id === id ? { ...region, size } : region,
				),
			}));
		},
		[pushState],
	);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			const mod = e.ctrlKey || e.metaKey;
			const key = e.key.toLowerCase();

			if (mod && key === "z" && !e.shiftKey) {
				e.preventDefault();
				e.stopPropagation();
				undo();
				return;
			}
			if (mod && (key === "y" || (key === "z" && e.shiftKey))) {
				e.preventDefault();
				e.stopPropagation();
				redo();
				return;
			}

			// Frame-step navigation (arrow keys, no modifiers)
			if (
				(e.key === "ArrowLeft" || e.key === "ArrowRight") &&
				!e.ctrlKey &&
				!e.metaKey &&
				!e.shiftKey &&
				!e.altKey
			) {
				const target = e.target;
				if (
					target instanceof HTMLInputElement ||
					target instanceof HTMLTextAreaElement ||
					target instanceof HTMLSelectElement ||
					(target instanceof HTMLElement &&
						(target.isContentEditable ||
							target.closest('[role="separator"], [role="slider"], [role="spinbutton"]')))
				) {
					return;
				}
				e.preventDefault();
				const video = videoPlaybackRef.current?.video;
				if (!video) {
					return;
				}
				const direction = e.key === "ArrowLeft" ? "backward" : "forward";
				const newTime = computeFrameStepTime(
					video.currentTime,
					Number.isFinite(video.duration) ? video.duration : durationRef.current,
					direction,
				);
				video.currentTime = newTime;
				return;
			}

			const isInput =
				e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

			if (e.key === "Tab" && !isInput) {
				e.preventDefault();
			}

			if (matchesShortcut(e, shortcuts.playPause, isMac)) {
				// Allow space only in inputs/textareas
				if (isInput) {
					return;
				}
				e.preventDefault();
				const playback = videoPlaybackRef.current;
				if (playback?.video) {
					playback.video.paused ? playback.play().catch(console.error) : playback.pause();
				}
			}
		};

		window.addEventListener("keydown", handleKeyDown, { capture: true });
		return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
	}, [undo, redo, shortcuts, isMac]);

	useEffect(() => {
		if (selectedZoomId && !zoomRegions.some((region) => region.id === selectedZoomId)) {
			setSelectedZoomId(null);
		}
	}, [selectedZoomId, zoomRegions]);

	useEffect(() => {
		if (selectedTrimId && !trimRegions.some((region) => region.id === selectedTrimId)) {
			setSelectedTrimId(null);
		}
	}, [selectedTrimId, trimRegions]);

	useEffect(() => {
		if (
			selectedAnnotationId &&
			!annotationOnlyRegions.some((region) => region.id === selectedAnnotationId)
		) {
			setSelectedAnnotationId(null);
		}
		if (selectedBlurId && !blurRegions.some((region) => region.id === selectedBlurId)) {
			setSelectedBlurId(null);
		}
	}, [selectedAnnotationId, selectedBlurId, annotationOnlyRegions, blurRegions]);

	useEffect(() => {
		if (selectedSpeedId && !speedRegions.some((region) => region.id === selectedSpeedId)) {
			setSelectedSpeedId(null);
		}
	}, [selectedSpeedId, speedRegions]);

	const handleShowExportedFile = useCallback(async (filePath: string) => {
		try {
			const result = await window.electronAPI.revealInFolder(filePath);
			if (!result.success) {
				const errorMessage = result.error || result.message || "Failed to reveal item in folder.";
				console.error("Failed to reveal in folder:", errorMessage);
				toast.error(errorMessage);
			}
		} catch (error) {
			const errorMessage = String(error);
			console.error("Error calling revealInFolder IPC:", errorMessage);
			toast.error(`Error revealing in folder: ${errorMessage}`);
		}
	}, []);

	const handleExportSaved = useCallback(
		(formatLabel: "GIF" | "Video", filePath: string) => {
			setExportedFilePath(filePath);
			toast.success(
				t("export.exportedSuccessfully", {
					format: formatLabel,
				}),
				{
					description: filePath,
					action: {
						label: rawT("common.actions.showInFolder"),
						onClick: () => {
							void handleShowExportedFile(filePath);
						},
					},
				},
			);
		},
		[handleShowExportedFile, t, rawT],
	);

	const handleSaveUnsavedExport = useCallback(async () => {
		if (!unsavedExport) return;
		try {
			const saveResult = await window.electronAPI.saveExportedVideo(
				unsavedExport.arrayBuffer,
				unsavedExport.fileName,
			);
			if (saveResult.canceled) {
				toast.info("Export canceled");
			} else if (saveResult.success && saveResult.path) {
				setUnsavedExport(null);
				handleExportSaved(unsavedExport.format === "gif" ? "GIF" : "Video", saveResult.path);
			} else {
				toast.error(saveResult.message || "Failed to save export");
			}
		} catch (error) {
			console.error("Error saving unsaved export:", error);
			toast.error("Failed to save exported video");
		}
	}, [unsavedExport, handleExportSaved]);

	const handleExport = useCallback(
		async (settings: ExportSettings) => {
			if (!videoPath) {
				toast.error("No video loaded");
				return;
			}

			const video = videoPlaybackRef.current?.video;
			if (!video) {
				toast.error("Video not ready");
				return;
			}

			setIsExporting(true);
			setExportProgress(null);
			setExportError(null);
			setExportedFilePath(null);

			try {
				const wasPlaying = isPlaying;
				if (wasPlaying) {
					videoPlaybackRef.current?.pause();
				}

				const sourceWidth = video.videoWidth || 1920;
				const sourceHeight = video.videoHeight || 1080;
				const aspectRatioValue =
					aspectRatio === "native"
						? getNativeAspectRatioValue(sourceWidth, sourceHeight, cropRegion)
						: getAspectRatioValue(aspectRatio);

				// Get preview CONTAINER dimensions for scaling
				const playbackRef = videoPlaybackRef.current;
				const containerElement = playbackRef?.containerRef?.current;
				const previewWidth = containerElement?.clientWidth || 1920;
				const previewHeight = containerElement?.clientHeight || 1080;

				if (settings.format === "gif" && settings.gifConfig) {
					// GIF Export
					const gifExporter = new GifExporter({
						videoUrl: videoPath,
						webcamVideoUrl: webcamVideoPath || undefined,
						width: settings.gifConfig.width,
						height: settings.gifConfig.height,
						frameRate: settings.gifConfig.frameRate,
						loop: settings.gifConfig.loop,
						sizePreset: settings.gifConfig.sizePreset,
						wallpaper,
						zoomRegions,
						trimRegions,
						speedRegions,
						showShadow: shadowIntensity > 0,
						shadowIntensity,
						showBlur,
						motionBlurAmount,
						borderRadius,
						padding,
						videoPadding: padding,
						cropRegion,
						annotationRegions,
						webcamLayoutPreset,
						webcamMaskShape,
						webcamSizePreset,
						webcamPosition,
						previewWidth,
						previewHeight,
						cursorTelemetry,
						cursorClickTimestamps,
						cursorHighlight: effectiveCursorHighlight,
						onProgress: (progress: ExportProgress) => {
							setExportProgress(progress);
						},
					});

					exporterRef.current = gifExporter as unknown as VideoExporter;
					const result = await gifExporter.export();

					if (result.success && result.blob) {
						const arrayBuffer = await result.blob.arrayBuffer();
						const timestamp = Date.now();
						const fileName = `export-${timestamp}.gif`;

						if (result.warnings) {
							for (const warning of result.warnings) {
								toast.warning(warning);
							}
						}

						const saveResult = await window.electronAPI.saveExportedVideo(arrayBuffer, fileName);

						if (saveResult.canceled) {
							setUnsavedExport({ arrayBuffer, fileName, format: "gif" });
							toast.info("Export canceled");
						} else if (saveResult.success && saveResult.path) {
							setUnsavedExport(null);
							handleExportSaved("GIF", saveResult.path);
						} else {
							setExportError(saveResult.message || "Failed to save GIF");
							toast.error(saveResult.message || "Failed to save GIF");
						}
					} else {
						setExportError(result.error || "GIF export failed");
						toast.error(result.error || "GIF export failed");
					}
				} else {
					// MP4 Export
					const quality = settings.quality || exportQuality;
					let exportWidth: number;
					let exportHeight: number;
					let bitrate: number;

					if (quality === "source") {
						// Use source resolution
						exportWidth = sourceWidth;
						exportHeight = sourceHeight;

						if (aspectRatioValue === 1) {
							// Square (1:1): use smaller dimension to avoid codec limits
							const baseDimension = Math.floor(Math.min(sourceWidth, sourceHeight) / 2) * 2;
							exportWidth = baseDimension;
							exportHeight = baseDimension;
						} else if (aspectRatioValue > 1) {
							// Landscape: find largest even dimensions that exactly match aspect ratio
							const baseWidth = Math.floor(sourceWidth / 2) * 2;
							let found = false;
							for (let w = baseWidth; w >= 100 && !found; w -= 2) {
								const h = Math.round(w / aspectRatioValue);
								if (h % 2 === 0 && Math.abs(w / h - aspectRatioValue) < 0.0001) {
									exportWidth = w;
									exportHeight = h;
									found = true;
								}
							}
							if (!found) {
								exportWidth = baseWidth;
								exportHeight = Math.floor(baseWidth / aspectRatioValue / 2) * 2;
							}
						} else {
							// Portrait: find largest even dimensions that exactly match aspect ratio
							const baseHeight = Math.floor(sourceHeight / 2) * 2;
							let found = false;
							for (let h = baseHeight; h >= 100 && !found; h -= 2) {
								const w = Math.round(h * aspectRatioValue);
								if (w % 2 === 0 && Math.abs(w / h - aspectRatioValue) < 0.0001) {
									exportWidth = w;
									exportHeight = h;
									found = true;
								}
							}
							if (!found) {
								exportHeight = baseHeight;
								exportWidth = Math.floor((baseHeight * aspectRatioValue) / 2) * 2;
							}
						}

						// Calculate visually lossless bitrate matching screen recording optimization
						const totalPixels = exportWidth * exportHeight;
						bitrate = 30_000_000;
						if (totalPixels > 1920 * 1080 && totalPixels <= 2560 * 1440) {
							bitrate = 50_000_000;
						} else if (totalPixels > 2560 * 1440) {
							bitrate = 80_000_000;
						}
					} else {
						// Use quality-based target resolution
						const targetHeight = quality === "medium" ? 720 : 1080;

						// Calculate dimensions maintaining aspect ratio
						exportHeight = Math.floor(targetHeight / 2) * 2;
						exportWidth = Math.floor((exportHeight * aspectRatioValue) / 2) * 2;

						// Adjust bitrate for lower resolutions
						const totalPixels = exportWidth * exportHeight;
						if (totalPixels <= 1280 * 720) {
							bitrate = 10_000_000;
						} else if (totalPixels <= 1920 * 1080) {
							bitrate = 20_000_000;
						} else {
							bitrate = 30_000_000;
						}
					}

					const exporter = new VideoExporter({
						videoUrl: videoPath,
						webcamVideoUrl: webcamVideoPath || undefined,
						width: exportWidth,
						height: exportHeight,
						frameRate: 60,
						bitrate,
						codec: "avc1.640033",
						wallpaper,
						zoomRegions,
						trimRegions,
						speedRegions,
						showShadow: shadowIntensity > 0,
						shadowIntensity,
						showBlur,
						motionBlurAmount,
						borderRadius,
						padding,
						cropRegion,
						annotationRegions,
						webcamLayoutPreset,
						webcamMaskShape,
						webcamSizePreset,
						webcamPosition,
						previewWidth,
						previewHeight,
						cursorTelemetry,
						cursorClickTimestamps,
						cursorHighlight: effectiveCursorHighlight,
						onProgress: (progress: ExportProgress) => {
							setExportProgress(progress);
						},
					});

					exporterRef.current = exporter;
					const result = await exporter.export();

					if (result.success && result.blob) {
						const arrayBuffer = await result.blob.arrayBuffer();
						const timestamp = Date.now();
						const fileName = `export-${timestamp}.mp4`;

						if (result.warnings) {
							for (const warning of result.warnings) {
								toast.warning(warning);
							}
						}

						const saveResult = await window.electronAPI.saveExportedVideo(arrayBuffer, fileName);

						if (saveResult.canceled) {
							setUnsavedExport({ arrayBuffer, fileName, format: "mp4" });
							toast.info("Export canceled");
						} else if (saveResult.success && saveResult.path) {
							setUnsavedExport(null);
							handleExportSaved("Video", saveResult.path);
						} else {
							setExportError(saveResult.message || "Failed to save video");
							toast.error(saveResult.message || "Failed to save video");
						}
					} else {
						setExportError(result.error || "Export failed");
						toast.error(result.error || "Export failed");
					}
				}

				if (wasPlaying) {
					videoPlaybackRef.current?.play();
				}
			} catch (error) {
				console.error("Export error:", error);
				if (error instanceof BackgroundLoadError) {
					const message = t("errors.exportBackgroundLoadFailed", { url: error.displayUrl });
					setExportError(message);
					toast.error(message);
				} else {
					const errorMessage = error instanceof Error ? error.message : "Unknown error";
					setExportError(errorMessage);
					toast.error(t("errors.exportFailedWithError", { error: errorMessage }));
				}
			} finally {
				setIsExporting(false);
				exporterRef.current = null;
				// Reset dialog state to ensure it can be opened again on next export
				// This fixes the bug where second export doesn't show save dialog
				setShowExportDialog(false);
				setExportProgress(null);
			}
		},
		[
			videoPath,
			webcamVideoPath,
			wallpaper,
			zoomRegions,
			trimRegions,
			speedRegions,
			shadowIntensity,
			showBlur,
			motionBlurAmount,
			borderRadius,
			padding,
			cropRegion,
			annotationRegions,
			isPlaying,
			aspectRatio,
			webcamLayoutPreset,
			webcamMaskShape,
			webcamSizePreset,
			webcamPosition,
			exportQuality,
			handleExportSaved,
			cursorTelemetry,
			cursorClickTimestamps,
			effectiveCursorHighlight,
			t,
		],
	);

	const handleOpenExportDialog = useCallback(() => {
		if (!videoPath) {
			toast.error("No video loaded");
			return;
		}

		const video = videoPlaybackRef.current?.video;
		if (!video) {
			toast.error("Video not ready");
			return;
		}

		// Build export settings from current state
		const sourceWidth = video.videoWidth || 1920;
		const sourceHeight = video.videoHeight || 1080;
		const aspectRatioValue =
			aspectRatio === "native"
				? getNativeAspectRatioValue(sourceWidth, sourceHeight, cropRegion)
				: getAspectRatioValue(aspectRatio);
		const gifDimensions = calculateOutputDimensions(
			sourceWidth,
			sourceHeight,
			gifSizePreset,
			GIF_SIZE_PRESETS,
			aspectRatioValue,
		);

		const settings: ExportSettings = {
			format: exportFormat,
			quality: exportFormat === "mp4" ? exportQuality : undefined,
			gifConfig:
				exportFormat === "gif"
					? {
							frameRate: gifFrameRate,
							loop: gifLoop,
							sizePreset: gifSizePreset,
							width: gifDimensions.width,
							height: gifDimensions.height,
						}
					: undefined,
		};

		setShowExportDialog(true);
		setExportError(null);
		setExportedFilePath(null);

		// Start export immediately
		handleExport(settings);
	}, [
		videoPath,
		exportFormat,
		exportQuality,
		gifFrameRate,
		gifLoop,
		gifSizePreset,
		aspectRatio,
		cropRegion,
		handleExport,
	]);

	const handleCancelExport = useCallback(() => {
		if (exporterRef.current) {
			exporterRef.current.cancel();
			toast.info("Export canceled");
			setShowExportDialog(false);
			setIsExporting(false);
			setExportProgress(null);
			setExportError(null);
			setExportedFilePath(null);
		}
	}, []);

	const mcpEditorCommandHandlerRef = useRef<
		(method: string, args: unknown) => Promise<unknown> | unknown
	>(async () => ({ success: false, message: "Editor MCP handler is not ready." }));

	const getMcpProjectEditorState = () => ({
		wallpaper,
		shadowIntensity,
		showBlur,
		motionBlurAmount,
		borderRadius,
		padding,
		cropRegion,
		zoomRegions,
		trimRegions,
		speedRegions,
		annotationRegions,
		aspectRatio,
		webcamLayoutPreset,
		webcamMaskShape,
		webcamSizePreset,
		webcamPosition,
		exportQuality,
		exportFormat,
		gifFrameRate,
		gifLoop,
		gifSizePreset,
		cursorHighlight,
	});

	const getMcpSelectionState = () => ({
		selectedZoomId,
		selectedTrimId,
		selectedSpeedId,
		selectedAnnotationId,
		selectedBlurId,
	});

	const getMcpPlaybackState = () => ({
		currentTime,
		currentTimeMs: Math.round(currentTime * 1000),
		duration,
		durationMs: Math.round(duration * 1000),
		isPlaying,
		isFullscreen,
	});

	const getMcpExportSettings = () => ({
		exportFormat,
		exportQuality,
		gifFrameRate,
		gifLoop,
		gifSizePreset,
		isExporting,
		exportProgress,
		exportError,
		exportedFilePath,
		hasPendingExport: Boolean(unsavedExport),
	});

	const getMcpProjectSummary = () => ({
		success: true,
		loading,
		error,
		paths: {
			videoPath,
			videoSourcePath,
			webcamVideoPath,
			webcamVideoSourcePath,
			currentProjectPath,
		},
		media: currentProjectMedia,
		editor: getMcpProjectEditorState(),
		selection: getMcpSelectionState(),
		playback: getMcpPlaybackState(),
		export: getMcpExportSettings(),
		hasUnsavedChanges,
		currentProjectSnapshot,
		cursorTelemetry: {
			sampleCount: cursorTelemetry.length,
			clickCount: cursorClickTimestamps.length,
		},
	});

	const commitMcpEditorPatch = (
		patch: Partial<typeof editorState>,
		commit = true,
	): Record<string, unknown> => {
		if (commit) {
			pushState(patch);
			commitState();
		} else {
			updateState(patch);
		}
		return { success: true, patch, commit };
	};

	const getMcpSpan = (input: Record<string, unknown>) => {
		const span = isRecord(input.span) ? input.span : input;
		const durationMs = finiteNumber(input.durationMs) ?? Math.round(duration * 1000);
		const defaultStart = input.useCurrentTime ? currentTime * 1000 : 0;
		const rawStart =
			finiteNumber(span.startMs) ??
			finiteNumber(span.start) ??
			finiteNumber(input.timeMs) ??
			defaultStart;
		const rawEnd =
			finiteNumber(span.endMs) ??
			finiteNumber(span.end) ??
			Math.min(rawStart + 1000, durationMs || rawStart + 1000);
		const startMs = Math.max(0, Math.round(rawStart));
		const endMs = Math.max(startMs + 1, Math.round(rawEnd));
		return { startMs, endMs };
	};

	const getMcpId = (input: Record<string, unknown>, ...keys: string[]) => {
		for (const key of ["id", "regionId", "annotationId", "fontId", ...keys]) {
			const value = input[key];
			if (typeof value === "string" && value.trim()) {
				return value.trim();
			}
		}
		return null;
	};

	const buildMcpExportSettings = (input: Record<string, unknown>): ExportSettings => {
		const source = isRecord(input.settings) ? input.settings : input;
		const nextFormat =
			source.format === "gif" || source.exportFormat === "gif"
				? "gif"
				: source.format === "mp4" || source.exportFormat === "mp4"
					? "mp4"
					: exportFormat;
		const nextQuality =
			source.quality === "medium" || source.quality === "good" || source.quality === "source"
				? source.quality
				: source.exportQuality === "medium" ||
						source.exportQuality === "good" ||
						source.exportQuality === "source"
					? source.exportQuality
					: exportQuality;
		const gifConfig = isRecord(source.gifConfig) ? source.gifConfig : {};
		const nextGifFrameRate =
			finiteNumber(source.frameRate) ??
			finiteNumber(source.gifFrameRate) ??
			finiteNumber(gifConfig.frameRate) ??
			gifFrameRate;
		const nextGifLoop =
			booleanValue(source.loop) ??
			booleanValue(source.gifLoop) ??
			booleanValue(gifConfig.loop) ??
			gifLoop;
		const nextGifSizePreset =
			source.sizePreset === "medium" ||
			source.sizePreset === "large" ||
			source.sizePreset === "original"
				? source.sizePreset
				: source.gifSizePreset === "medium" ||
						source.gifSizePreset === "large" ||
						source.gifSizePreset === "original"
					? source.gifSizePreset
					: gifConfig.sizePreset === "medium" ||
							gifConfig.sizePreset === "large" ||
							gifConfig.sizePreset === "original"
						? gifConfig.sizePreset
						: gifSizePreset;
		const video = videoPlaybackRef.current?.video;
		const sourceWidth = video?.videoWidth || 1920;
		const sourceHeight = video?.videoHeight || 1080;
		const aspectRatioValue =
			aspectRatio === "native"
				? getNativeAspectRatioValue(sourceWidth, sourceHeight, cropRegion)
				: getAspectRatioValue(aspectRatio);
		const gifDimensions = calculateOutputDimensions(
			sourceWidth,
			sourceHeight,
			nextGifSizePreset,
			GIF_SIZE_PRESETS,
			aspectRatioValue,
		);

		return {
			format: nextFormat,
			quality: nextFormat === "mp4" ? (nextQuality as ExportQuality) : undefined,
			gifConfig:
				nextFormat === "gif"
					? {
							frameRate: nextGifFrameRate as GifFrameRate,
							loop: nextGifLoop,
							sizePreset: nextGifSizePreset as GifSizePreset,
							width: gifDimensions.width,
							height: gifDimensions.height,
						}
					: undefined,
		};
	};

	mcpEditorCommandHandlerRef.current = async (method: string, args: unknown) => {
		const input = isRecord(args) ? args : {};
		const commit = booleanValue(input.commit) ?? true;

		const updateAnnotationById = (
			id: string,
			updater: (region: AnnotationRegion) => AnnotationRegion,
			commitUpdate = commit,
		) => {
			let updatedRegion: AnnotationRegion | null = null;
			const update = (prev: typeof editorState) => ({
				annotationRegions: prev.annotationRegions.map((region) => {
					if (region.id !== id) return region;
					updatedRegion = updater(region);
					return updatedRegion;
				}),
			});
			if (commitUpdate) {
				pushState(update);
			} else {
				updateState(update);
			}
			return updatedRegion
				? { success: true, id, region: updatedRegion }
				: { success: false, id, message: "Annotation region not found." };
		};

		switch (method) {
			case "project.current.get":
			case "media.current.get":
				return getMcpProjectSummary();
			case "project.snapshot.get":
				return {
					success: true,
					snapshot: currentProjectSnapshot,
					hasUnsavedChanges,
				};
			case "project.save": {
				const saved = await saveProject(booleanValue(input.forceSaveAs) ?? false);
				return { success: saved, currentProjectPath };
			}
			case "project.load": {
				const result = await window.electronAPI.loadProjectFile();
				if (result.canceled || !result.success) return result;
				const restored = await applyLoadedProject(result.project, result.path ?? null);
				return { ...result, restored };
			}
			case "project.applyEditorState": {
				const normalized = normalizeProjectEditor(
					(isRecord(input.editor) ? input.editor : input) as Partial<
						ReturnType<typeof getMcpProjectEditorState>
					>,
				);
				const media = isRecord(input.media) ? (input.media as unknown as ProjectMedia) : null;
				if (media?.screenVideoPath) {
					setVideoSourcePath(media.screenVideoPath);
					setVideoPath(toFileUrl(media.screenVideoPath));
					setWebcamVideoSourcePath(media.webcamVideoPath ?? null);
					setWebcamVideoPath(media.webcamVideoPath ? toFileUrl(media.webcamVideoPath) : null);
				}
				commitMcpEditorPatch(
					{
						wallpaper: normalized.wallpaper,
						shadowIntensity: normalized.shadowIntensity,
						showBlur: normalized.showBlur,
						motionBlurAmount: normalized.motionBlurAmount,
						borderRadius: normalized.borderRadius,
						padding: normalized.padding,
						cropRegion: normalized.cropRegion,
						zoomRegions: normalized.zoomRegions,
						trimRegions: normalized.trimRegions,
						speedRegions: normalized.speedRegions,
						annotationRegions: normalized.annotationRegions,
						aspectRatio: normalized.aspectRatio,
						webcamLayoutPreset: normalized.webcamLayoutPreset,
						webcamMaskShape: normalized.webcamMaskShape,
						webcamSizePreset: normalized.webcamSizePreset,
						webcamPosition: normalized.webcamPosition,
						cursorHighlight: normalized.cursorHighlight,
					},
					commit,
				);
				setExportQuality(normalized.exportQuality);
				setExportFormat(normalized.exportFormat);
				setGifFrameRate(normalized.gifFrameRate);
				setGifLoop(normalized.gifLoop);
				setGifSizePreset(normalized.gifSizePreset);
				return { success: true, editor: normalized, media };
			}
			case "timeline.state.get":
				return {
					...getMcpProjectSummary(),
					timeline: {
						zoomRegions,
						trimRegions,
						speedRegions,
						annotationRegions: annotationOnlyRegions,
						blurRegions,
						range: null,
						keyframes: [],
					},
				};
			case "timeline.seek": {
				const timeMs = finiteNumber(input.timeMs) ?? 0;
				handleSeek(timeMs / 1000);
				return { success: true, timeMs, persisted: false };
			}
			case "timeline.range.set":
				return {
					success: false,
					persisted: false,
					supported: false,
					message: "Timeline range is local to TimelineEditor.",
				};
			case "timeline.zoom.add": {
				const span = getMcpSpan(input);
				const depth = clampNumber(
					finiteNumber(input.depth) ?? DEFAULT_ZOOM_DEPTH,
					1,
					6,
				) as ZoomDepth;
				const focus = isRecord(input.focus)
					? {
							cx: clampNumber(finiteNumber(input.focus.cx) ?? 0.5, 0, 1),
							cy: clampNumber(finiteNumber(input.focus.cy) ?? 0.5, 0, 1),
						}
					: { cx: 0.5, cy: 0.5 };
				const region: ZoomRegion = {
					id: `zoom-${nextZoomIdRef.current++}`,
					...span,
					depth,
					focus: clampFocusToDepth(focus, depth),
					...(input.focusMode === "manual" || input.focusMode === "auto"
						? { focusMode: input.focusMode }
						: {}),
					...(input.rotationPreset === "iso" ||
					input.rotationPreset === "left" ||
					input.rotationPreset === "right"
						? { rotationPreset: input.rotationPreset }
						: {}),
				};
				pushState((prev) => ({ zoomRegions: [...prev.zoomRegions, region] }));
				handleSelectZoom(region.id);
				return { success: true, region };
			}
			case "timeline.zoom.update": {
				const id = getMcpId(input);
				if (!id) throw new Error("timeline.zoom.update requires id.");
				const span =
					isRecord(input.span) || "startMs" in input || "endMs" in input ? getMcpSpan(input) : null;
				let region: ZoomRegion | null = null;
				pushState((prev) => ({
					zoomRegions: prev.zoomRegions.map((candidate) => {
						if (candidate.id !== id) return candidate;
						const depth = clampNumber(
							finiteNumber(input.depth) ?? candidate.depth,
							1,
							6,
						) as ZoomDepth;
						region = {
							...candidate,
							...(span ?? {}),
							depth,
							focus: isRecord(input.focus)
								? clampFocusToDepth(
										{
											cx: clampNumber(finiteNumber(input.focus.cx) ?? candidate.focus.cx, 0, 1),
											cy: clampNumber(finiteNumber(input.focus.cy) ?? candidate.focus.cy, 0, 1),
										},
										depth,
									)
								: clampFocusToDepth(candidate.focus, depth),
							...(input.focusMode === "manual" || input.focusMode === "auto"
								? { focusMode: input.focusMode }
								: {}),
							...(input.rotationPreset === "iso" ||
							input.rotationPreset === "left" ||
							input.rotationPreset === "right"
								? { rotationPreset: input.rotationPreset }
								: {}),
						};
						return region;
					}),
				}));
				return region ? { success: true, id, region } : { success: false, id };
			}
			case "timeline.zoom.delete": {
				const id = getMcpId(input);
				if (!id) throw new Error("timeline.zoom.delete requires id.");
				handleZoomDelete(id);
				return { success: true, id };
			}
			case "timeline.trim.add": {
				const span = getMcpSpan(input);
				const region: TrimRegion = { id: `trim-${nextTrimIdRef.current++}`, ...span };
				pushState((prev) => ({ trimRegions: [...prev.trimRegions, region] }));
				handleSelectTrim(region.id);
				return { success: true, region };
			}
			case "timeline.trim.update": {
				const id = getMcpId(input);
				if (!id) throw new Error("timeline.trim.update requires id.");
				const span = getMcpSpan(input);
				handleTrimSpanChange(id, { start: span.startMs, end: span.endMs });
				return { success: true, id, span };
			}
			case "timeline.trim.delete": {
				const id = getMcpId(input);
				if (!id) throw new Error("timeline.trim.delete requires id.");
				handleTrimDelete(id);
				return { success: true, id };
			}
			case "timeline.speed.add": {
				const span = getMcpSpan(input);
				const region: SpeedRegion = {
					id: `speed-${nextSpeedIdRef.current++}`,
					...span,
					speed: clampNumber(
						finiteNumber(input.speed) ?? DEFAULT_PLAYBACK_SPEED,
						0.1,
						16,
					) as PlaybackSpeed,
				};
				pushState((prev) => ({ speedRegions: [...prev.speedRegions, region] }));
				handleSelectSpeed(region.id);
				return { success: true, region };
			}
			case "timeline.speed.update": {
				const id = getMcpId(input);
				if (!id) throw new Error("timeline.speed.update requires id.");
				const span =
					isRecord(input.span) || "startMs" in input || "endMs" in input ? getMcpSpan(input) : null;
				let region: SpeedRegion | null = null;
				pushState((prev) => ({
					speedRegions: prev.speedRegions.map((candidate) => {
						if (candidate.id !== id) return candidate;
						region = {
							...candidate,
							...(span ?? {}),
							...(finiteNumber(input.speed) !== null
								? { speed: clampNumber(finiteNumber(input.speed)!, 0.1, 16) as PlaybackSpeed }
								: {}),
						};
						return region;
					}),
				}));
				return region ? { success: true, id, region } : { success: false, id };
			}
			case "timeline.speed.delete": {
				const id = getMcpId(input);
				if (!id) throw new Error("timeline.speed.delete requires id.");
				handleSpeedDelete(id);
				return { success: true, id };
			}
			case "timeline.annotation.add":
			case "annotations.add": {
				const span = getMcpSpan(input);
				const sourceAnnotation = isRecord(input.annotation) ? input.annotation : input;
				const type =
					sourceAnnotation.type === "image" || sourceAnnotation.type === "figure"
						? sourceAnnotation.type
						: "text";
				const id = `annotation-${nextAnnotationIdRef.current++}`;
				const zIndex = nextAnnotationZIndexRef.current++;
				const region: AnnotationRegion = {
					id,
					...span,
					type,
					content:
						typeof sourceAnnotation.content === "string"
							? sourceAnnotation.content
							: type === "text"
								? "Enter text..."
								: "",
					position: isRecord(sourceAnnotation.position)
						? {
								x: clampNumber(finiteNumber(sourceAnnotation.position.x) ?? 50, 0, 100),
								y: clampNumber(finiteNumber(sourceAnnotation.position.y) ?? 50, 0, 100),
							}
						: { ...DEFAULT_ANNOTATION_POSITION },
					size: isRecord(sourceAnnotation.size)
						? {
								width: clampNumber(finiteNumber(sourceAnnotation.size.width) ?? 25, 1, 200),
								height: clampNumber(finiteNumber(sourceAnnotation.size.height) ?? 15, 1, 200),
							}
						: { ...DEFAULT_ANNOTATION_SIZE },
					style: {
						...DEFAULT_ANNOTATION_STYLE,
						...(isRecord(sourceAnnotation.style) ? sourceAnnotation.style : {}),
					},
					zIndex,
					...(isRecord(sourceAnnotation.figureData)
						? { figureData: sourceAnnotation.figureData as unknown as FigureData }
						: type === "figure"
							? { figureData: { ...DEFAULT_FIGURE_DATA } }
							: {}),
				};
				pushState((prev) => ({ annotationRegions: [...prev.annotationRegions, region] }));
				handleSelectAnnotation(id);
				return { success: true, region };
			}
			case "timeline.annotation.update": {
				const id = getMcpId(input);
				if (!id) throw new Error("timeline.annotation.update requires id.");
				const span = getMcpSpan(input);
				return updateAnnotationById(id, (region) => ({ ...region, ...span }));
			}
			case "timeline.annotation.delete":
			case "annotations.delete": {
				const id = getMcpId(input);
				if (!id) throw new Error(`${method} requires id.`);
				handleAnnotationDelete(id);
				return { success: true, id };
			}
			case "timeline.blur.add":
			case "blurs.add": {
				const span = getMcpSpan(input);
				const id = `annotation-${nextAnnotationIdRef.current++}`;
				const zIndex = nextAnnotationZIndexRef.current++;
				const blurData = isRecord(input.blurData)
					? input.blurData
					: isRecord(input.data)
						? input.data
						: input;
				const region: AnnotationRegion = {
					id,
					...span,
					type: "blur",
					content: "",
					position: isRecord(input.position)
						? {
								x: clampNumber(finiteNumber(input.position.x) ?? 50, 0, 100),
								y: clampNumber(finiteNumber(input.position.y) ?? 50, 0, 100),
							}
						: { ...DEFAULT_ANNOTATION_POSITION },
					size: isRecord(input.size)
						? {
								width: clampNumber(finiteNumber(input.size.width) ?? 25, 1, 200),
								height: clampNumber(finiteNumber(input.size.height) ?? 15, 1, 200),
							}
						: { ...DEFAULT_ANNOTATION_SIZE },
					style: { ...DEFAULT_ANNOTATION_STYLE },
					zIndex,
					blurData: { ...DEFAULT_BLUR_DATA, ...(isRecord(blurData) ? blurData : {}) } as BlurData,
				};
				pushState((prev) => ({ annotationRegions: [...prev.annotationRegions, region] }));
				handleSelectBlur(id);
				return { success: true, region };
			}
			case "timeline.blur.update": {
				const id = getMcpId(input);
				if (!id) throw new Error("timeline.blur.update requires id.");
				const span = getMcpSpan(input);
				return updateAnnotationById(id, (region) => ({ ...region, ...span }));
			}
			case "timeline.blur.delete":
			case "blurs.delete": {
				const id = getMcpId(input);
				if (!id) throw new Error(`${method} requires id.`);
				handleAnnotationDelete(id);
				return { success: true, id };
			}
			case "timeline.zoom.suggest":
				return {
					success: false,
					supported: false,
					message: "Cursor dwell suggestion remains a TimelineEditor-local action.",
				};
			case "timeline.keyframe.list":
			case "timeline.keyframe.add":
			case "timeline.keyframe.update":
			case "timeline.keyframe.delete":
				return { success: false, supported: false, keyframes: [] };
			case "preview.state.get":
				return getMcpProjectSummary();
			default:
				break;
		}

		if (method === "preview.zoom.focus.set") {
			const id = getMcpId(input);
			const focusInput = input.focus;
			if (!id || !isRecord(focusInput)) {
				throw new Error("preview.zoom.focus.set requires id and focus.");
			}
			const allowAutoFocusOverride = booleanValue(input.allowAutoFocusOverride) ?? false;
			let region: ZoomRegion | null = null;
			const update = (prev: typeof editorState) => ({
				zoomRegions: prev.zoomRegions.map((candidate) => {
					if (candidate.id !== id) return candidate;
					if (candidate.focusMode === "auto" && !allowAutoFocusOverride) {
						region = candidate;
						return candidate;
					}
					region = {
						...candidate,
						focus: clampFocusToDepth(
							{
								cx: clampNumber(finiteNumber(focusInput.cx) ?? candidate.focus.cx, 0, 1),
								cy: clampNumber(finiteNumber(focusInput.cy) ?? candidate.focus.cy, 0, 1),
							},
							candidate.depth,
						),
						focusMode: "manual",
					};
					return region;
				}),
			});
			commit ? pushState(update) : updateState(update);
			return region ? { success: true, id, region } : { success: false, id };
		}

		switch (method) {
			case "preview.webcam.position.set": {
				if (!isRecord(input.position))
					throw new Error("preview.webcam.position.set requires position.");
				const requirePictureInPicture = booleanValue(input.requirePictureInPicture) ?? true;
				if (requirePictureInPicture && webcamLayoutPreset !== "picture-in-picture") {
					return { success: false, message: "Webcam layout is not picture-in-picture." };
				}
				const position = {
					cx: clampNumber(finiteNumber(input.position.cx) ?? 0.5, 0, 1),
					cy: clampNumber(finiteNumber(input.position.cy) ?? 0.5, 0, 1),
				};
				return commitMcpEditorPatch({ webcamPosition: position }, commit);
			}
			case "preview.annotation.position.set":
			case "preview.annotation.size.set":
			case "annotations.position.set":
			case "annotations.size.set": {
				const id = getMcpId(input);
				if (!id) throw new Error(`${method} requires id.`);
				if (method.includes("position")) {
					const source = isRecord(input.position) ? input.position : input;
					return updateAnnotationById(id, (region) => ({
						...region,
						position: {
							x: clampNumber(finiteNumber(source.x) ?? region.position.x, 0, 100),
							y: clampNumber(finiteNumber(source.y) ?? region.position.y, 0, 100),
						},
					}));
				}
				const source = isRecord(input.size) ? input.size : input;
				return updateAnnotationById(id, (region) => ({
					...region,
					size: {
						width: clampNumber(finiteNumber(source.width) ?? region.size.width, 1, 200),
						height: clampNumber(finiteNumber(source.height) ?? region.size.height, 1, 200),
					},
				}));
			}
			case "preview.blur.freehand.set": {
				const id = getMcpId(input);
				if (!id) throw new Error("preview.blur.freehand.set requires id.");
				const blurData = isRecord(input.blurData) ? input.blurData : input;
				return updateAnnotationById(id, (region) => ({
					...region,
					position: { x: 0, y: 0 },
					size: { width: 100, height: 100 },
					blurData: { ...(region.blurData ?? DEFAULT_BLUR_DATA), ...blurData } as BlurData,
				}));
			}
			case "preview.fullscreen.set":
				setIsFullscreen(booleanValue(input.enabled) ?? false);
				return { success: true, enabled: booleanValue(input.enabled) ?? false, persisted: false };
			case "layout.options.get":
				return { success: true, state: getMcpProjectSummary() };
			case "layout.aspectRatio.set":
			case "layout.webcamLayout.set":
			case "layout.webcamMask.set":
			case "layout.webcamSize.set":
			case "effects.set":
			case "background.set":
			case "background.uploadImage": {
				const patch = isRecord(input.patch) ? input.patch : input;
				return commitMcpEditorPatch(omitUndefined(patch) as Partial<typeof editorState>, commit);
			}
			case "crop.get":
				return {
					success: true,
					cropRegion,
					pixels:
						videoPlaybackRef.current?.video && input.includePixels !== false
							? {
									x: Math.round(cropRegion.x * videoPlaybackRef.current.video.videoWidth),
									y: Math.round(cropRegion.y * videoPlaybackRef.current.video.videoHeight),
									width: Math.round(cropRegion.width * videoPlaybackRef.current.video.videoWidth),
									height: Math.round(
										cropRegion.height * videoPlaybackRef.current.video.videoHeight,
									),
								}
							: null,
				};
			case "crop.setNormalized":
			case "crop.setPixels":
			case "crop.applyAspectPreset":
				return commitMcpEditorPatch(
					{ cropRegion: (input.cropRegion ?? DEFAULT_CROP_REGION) as typeof cropRegion },
					commit,
				);
			case "crop.reset":
				return commitMcpEditorPatch({ cropRegion: { ...DEFAULT_CROP_REGION } }, commit);
			case "cursorHighlight.get":
				return {
					success: true,
					cursorHighlight,
					effectiveCursorHighlight,
					platform: isMac ? "darwin" : "other",
				};
			case "cursorHighlight.set":
				return commitMcpEditorPatch(
					{ cursorHighlight: (input.cursorHighlight ?? cursorHighlight) as typeof cursorHighlight },
					commit,
				);
			case "cursorHighlight.patch":
				return commitMcpEditorPatch(
					{
						cursorHighlight: {
							...cursorHighlight,
							...(isRecord(input.patch) ? input.patch : input),
						},
					},
					commit,
				);
			case "annotations.list":
				return {
					success: true,
					annotations: input.includeBlur === true ? annotationRegions : annotationOnlyRegions,
				};
			case "annotations.type.set": {
				const id = getMcpId(input);
				if (!id || typeof input.type !== "string")
					throw new Error("annotations.type.set requires id and type.");
				handleAnnotationTypeChange(id, input.type as AnnotationRegion["type"]);
				return { success: true, id, type: input.type };
			}
			case "annotations.content.set": {
				const id = getMcpId(input);
				if (!id || typeof input.content !== "string")
					throw new Error("annotations.content.set requires id and content.");
				handleAnnotationContentChange(id, input.content);
				return { success: true, id, content: input.content };
			}
			case "annotations.style.set": {
				const id = getMcpId(input);
				const style = isRecord(input.style) ? input.style : input;
				if (!id) throw new Error("annotations.style.set requires id.");
				handleAnnotationStyleChange(id, style as Partial<AnnotationRegion["style"]>);
				return { success: true, id, style };
			}
			case "annotations.figure.set": {
				const id = getMcpId(input);
				const figureData = isRecord(input.figureData) ? input.figureData : input;
				if (!id) throw new Error("annotations.figure.set requires id.");
				handleAnnotationFigureDataChange(id, figureData as unknown as FigureData);
				return { success: true, id, figureData };
			}
			case "annotations.duplicate": {
				const id = getMcpId(input);
				if (!id) throw new Error("annotations.duplicate requires id.");
				handleAnnotationDuplicate(id);
				return { success: true, id };
			}
			case "blurs.list":
				return { success: true, blurs: blurRegions };
			case "blurs.data.set":
			case "blurs.data.preview": {
				const id = getMcpId(input);
				if (!id) throw new Error(`${method} requires id.`);
				const blurData = isRecord(input.blurData)
					? input.blurData
					: isRecord(input.data)
						? input.data
						: input;
				return updateAnnotationById(
					id,
					(region) => ({
						...region,
						...(isRecord(input.position)
							? { position: input.position as unknown as AnnotationRegion["position"] }
							: {}),
						...(isRecord(input.size)
							? { size: input.size as unknown as AnnotationRegion["size"] }
							: {}),
						blurData: { ...(region.blurData ?? DEFAULT_BLUR_DATA), ...blurData } as BlurData,
					}),
					method === "blurs.data.set" || commit,
				);
			}
			case "blurs.bounds.set": {
				const id = getMcpId(input);
				if (!id) throw new Error("blurs.bounds.set requires id.");
				return updateAnnotationById(id, (region) => ({
					...region,
					...(isRecord(input.position)
						? { position: input.position as unknown as AnnotationRegion["position"] }
						: {}),
					...(isRecord(input.size)
						? { size: input.size as unknown as AnnotationRegion["size"] }
						: {}),
				}));
			}
			case "customFonts.list":
				return { success: true, fonts: getCustomFonts() };
			case "customFonts.add": {
				if (!isRecord(input.font)) throw new Error("customFonts.add requires font.");
				const fonts = await addCustomFont(
					input.font as unknown as Parameters<typeof addCustomFont>[0],
				);
				return { success: true, fonts };
			}
			case "customFonts.remove": {
				const id = getMcpId(input);
				if (!id) throw new Error("customFonts.remove requires id.");
				return { success: true, fonts: removeCustomFont(id) };
			}
			case "export.settings.get":
				return {
					success: true,
					settings: getMcpExportSettings(),
					calculatedGifDimensions: buildMcpExportSettings({ format: "gif" }).gifConfig,
				};
			case "export.settings.set": {
				const source = isRecord(input.patch) ? input.patch : input;
				const nextSettings = buildMcpExportSettings(source);
				setExportFormat(nextSettings.format);
				if (nextSettings.quality) setExportQuality(nextSettings.quality);
				if (nextSettings.gifConfig) {
					setGifFrameRate(nextSettings.gifConfig.frameRate);
					setGifLoop(nextSettings.gifConfig.loop);
					setGifSizePreset(nextSettings.gifConfig.sizePreset);
				}
				if (input.persistToPreferences !== false) {
					saveUserPreferences({
						exportFormat: nextSettings.format,
						...(nextSettings.quality ? { exportQuality: nextSettings.quality } : {}),
					});
				}
				return { success: true, settings: nextSettings };
			}
			case "export.start": {
				if (!videoPath || !videoPlaybackRef.current?.video) {
					return { success: false, message: "Video is not ready." };
				}
				const settings = buildMcpExportSettings(isRecord(input.settings) ? input.settings : input);
				await handleExport(settings);
				return { success: true, settings };
			}
			case "export.cancel":
				handleCancelExport();
				return { success: true };
			case "export.savePending":
				await handleSaveUnsavedExport();
				return { success: true };
			case "shortcuts.get":
				return { success: true, shortcuts, isMac };
			case "shortcuts.apply":
				if (!isRecord(input.shortcuts)) throw new Error("shortcuts.apply requires shortcuts.");
				setShortcuts(input.shortcuts as ShortcutsConfig);
				return { success: true, shortcuts: input.shortcuts };
			case "preferences.get":
				return { success: true, preferences: loadUserPreferences() };
			case "preferences.set": {
				const patch = isRecord(input.patch) ? input.patch : input;
				saveUserPreferences(patch);
				const editorPatch: Partial<typeof editorState> = {};
				if (typeof patch.padding === "number") editorPatch.padding = patch.padding;
				if (typeof patch.aspectRatio === "string")
					editorPatch.aspectRatio = patch.aspectRatio as typeof aspectRatio;
				if (Object.keys(editorPatch).length > 0) pushState(editorPatch);
				if (
					patch.exportQuality === "medium" ||
					patch.exportQuality === "good" ||
					patch.exportQuality === "source"
				) {
					setExportQuality(patch.exportQuality);
				}
				if (patch.exportFormat === "mp4" || patch.exportFormat === "gif") {
					setExportFormat(patch.exportFormat);
				}
				return { success: true, preferences: loadUserPreferences() };
			}
			case "locale.get":
				return {
					success: true,
					locale,
					availableLocales,
				};
			case "locale.set":
				if (typeof input.locale !== "string") throw new Error("locale.set requires locale.");
				setLocale(input.locale as Locale);
				return { success: true, locale: input.locale };
			default:
				throw new Error(`Unsupported editor MCP command: ${method}`);
		}
	};

	useEffect(() => {
		const cleanup = window.electronAPI.onMcpCommand?.("editor", (method, args) =>
			mcpEditorCommandHandlerRef.current(method, args),
		);
		window.electronAPI.notifyMcpTargetReady?.("editor");
		return () => cleanup?.();
	}, []);

	if (loading) {
		return (
			<div className="flex items-center justify-center h-screen bg-background">
				<div className="text-foreground">{t("loadingVideo")}</div>
			</div>
		);
	}
	if (error) {
		return (
			<div className="flex items-center justify-center h-screen bg-background">
				<div className="flex flex-col items-center gap-3">
					<div className="text-destructive">{error}</div>
					<button
						type="button"
						onClick={handleLoadProject}
						className="px-3 py-1.5 rounded-md bg-[#34B27B] text-white text-sm hover:bg-[#34B27B]/90"
					>
						{ts("project.load")}
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col h-screen bg-[#09090b] text-slate-200 overflow-hidden selection:bg-[#34B27B]/30">
			<Dialog open={showNewRecordingDialog} onOpenChange={setShowNewRecordingDialog}>
				<DialogContent
					className="sm:max-w-[425px]"
					style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
				>
					<DialogHeader>
						<DialogTitle>{t("newRecording.title")}</DialogTitle>
						<DialogDescription>{t("newRecording.description")}</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<button
							type="button"
							onClick={() => setShowNewRecordingDialog(false)}
							className="px-4 py-2 rounded-md bg-white/10 text-white hover:bg-white/20 text-sm font-medium transition-colors"
						>
							{t("newRecording.cancel")}
						</button>
						<button
							type="button"
							onClick={handleNewRecordingConfirm}
							className="px-4 py-2 rounded-md bg-[#34B27B] text-white hover:bg-[#34B27B]/90 text-sm font-medium transition-colors"
						>
							{t("newRecording.confirm")}
						</button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<div
				className="h-10 flex-shrink-0 bg-[#09090b]/80 backdrop-blur-md border-b border-white/5 flex items-center justify-between px-6 z-50"
				style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
			>
				<div
					className="flex-1 flex items-center gap-1"
					style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
				>
					<div
						className={`flex items-center gap-1 px-2 py-1 rounded-md text-white/50 hover:text-white/90 hover:bg-white/10 transition-all duration-150 ${isMac ? "ml-14" : "ml-2"}`}
					>
						<Languages size={14} />
						<select
							value={locale}
							onChange={(e) => setLocale(e.target.value as Locale)}
							className="bg-transparent text-[11px] font-medium outline-none cursor-pointer appearance-none pr-1"
							style={{ color: "inherit" }}
						>
							{availableLocales.map((loc) => (
								<option key={loc} value={loc} className="bg-[#09090b] text-white">
									{getLocaleName(loc)}
								</option>
							))}
						</select>
					</div>
					<button
						type="button"
						onClick={() => setShowNewRecordingDialog(true)}
						className="flex items-center gap-1 px-2 py-1 rounded-md text-white/50 hover:text-white/90 hover:bg-white/10 transition-all duration-150 text-[11px] font-medium"
					>
						<Video size={14} />
						{t("newRecording.title")}
					</button>
					<button
						type="button"
						onClick={handleLoadProject}
						className="flex items-center gap-1 px-2 py-1 rounded-md text-white/50 hover:text-white/90 hover:bg-white/10 transition-all duration-150 text-[11px] font-medium"
					>
						<FolderOpen size={14} />
						{ts("project.load")}
					</button>
					<button
						type="button"
						onClick={handleSaveProject}
						className="flex items-center gap-1 px-2 py-1 rounded-md text-white/50 hover:text-white/90 hover:bg-white/10 transition-all duration-150 text-[11px] font-medium"
					>
						<Save size={14} />
						{ts("project.save")}
					</button>
				</div>
			</div>

			<div className="flex-1 p-5 gap-4 flex min-h-0 relative">
				{/* Left Column - Video & Timeline */}
				<div className="flex-[7] flex flex-col gap-3 min-w-0 h-full">
					<PanelGroup direction="vertical" className="gap-3">
						{/* Top section: video preview and controls */}
						<Panel defaultSize={70} maxSize={70} minSize={40}>
							<div
								ref={playerContainerRef}
								className={
									isFullscreen
										? "fixed inset-0 z-[99999] w-full h-full flex flex-col items-center justify-center bg-[#09090b]"
										: "w-full h-full flex flex-col items-center justify-center bg-black/40 rounded-2xl border border-white/5 shadow-2xl overflow-hidden relative"
								}
							>
								{/* Video preview */}
								<div className="w-full flex justify-center items-center flex-auto mt-1.5">
									<div
										className="relative flex justify-center items-center w-auto h-full max-w-full box-border"
										style={{
											aspectRatio:
												aspectRatio === "native"
													? getNativeAspectRatioValue(
															videoPlaybackRef.current?.video?.videoWidth || 1920,
															videoPlaybackRef.current?.video?.videoHeight || 1080,
															cropRegion,
														)
													: getAspectRatioValue(aspectRatio),
										}}
									>
										<VideoPlayback
											key={`${videoPath || "no-video"}:${webcamVideoPath || "no-webcam"}`}
											aspectRatio={aspectRatio}
											ref={videoPlaybackRef}
											videoPath={videoPath || ""}
											webcamVideoPath={webcamVideoPath || undefined}
											webcamLayoutPreset={webcamLayoutPreset}
											webcamMaskShape={webcamMaskShape}
											webcamSizePreset={webcamSizePreset}
											webcamPosition={webcamPosition}
											onWebcamPositionChange={(pos) => updateState({ webcamPosition: pos })}
											onWebcamPositionDragEnd={commitState}
											onDurationChange={setDuration}
											onTimeUpdate={setCurrentTime}
											currentTime={currentTime}
											onPlayStateChange={setIsPlaying}
											onError={setError}
											wallpaper={wallpaper}
											zoomRegions={zoomRegions}
											selectedZoomId={selectedZoomId}
											onSelectZoom={handleSelectZoom}
											onZoomFocusChange={handleZoomFocusChange}
											onZoomFocusDragEnd={commitState}
											isPlaying={isPlaying}
											showShadow={shadowIntensity > 0}
											shadowIntensity={shadowIntensity}
											showBlur={showBlur}
											motionBlurAmount={motionBlurAmount}
											borderRadius={borderRadius}
											padding={padding}
											cropRegion={cropRegion}
											trimRegions={trimRegions}
											speedRegions={speedRegions}
											annotationRegions={annotationOnlyRegions}
											selectedAnnotationId={selectedAnnotationId}
											onSelectAnnotation={handleSelectAnnotation}
											onAnnotationPositionChange={handleAnnotationPositionChange}
											onAnnotationSizeChange={handleAnnotationSizeChange}
											blurRegions={blurRegions}
											selectedBlurId={selectedBlurId}
											onSelectBlur={handleSelectBlur}
											onBlurPositionChange={handleAnnotationPositionChange}
											onBlurSizeChange={handleAnnotationSizeChange}
											onBlurDataChange={handleBlurDataPreviewChange}
											onBlurDataCommit={commitState}
											cursorTelemetry={cursorTelemetry}
											cursorHighlight={effectiveCursorHighlight}
											cursorClickTimestamps={cursorClickTimestamps}
										/>
									</div>
								</div>
								{/* Playback controls */}
								<div className="w-full flex justify-center items-center h-12 flex-shrink-0 px-3 py-1.5 my-1.5">
									<div className="w-full max-w-[700px]">
										<PlaybackControls
											isPlaying={isPlaying}
											currentTime={currentTime}
											duration={duration}
											isFullscreen={isFullscreen}
											onToggleFullscreen={toggleFullscreen}
											onTogglePlayPause={togglePlayPause}
											onSeek={handleSeek}
										/>
									</div>
								</div>
							</div>
						</Panel>

						<PanelResizeHandle className="bg-[#09090b]/80 hover:bg-[#09090b] transition-colors rounded-full flex items-center justify-center">
							<div className="w-8 h-1 bg-white/20 rounded-full"></div>
						</PanelResizeHandle>

						{/* Timeline section */}
						<Panel defaultSize={30} maxSize={60} minSize={30}>
							<div className="h-full bg-[#09090b] rounded-2xl border border-white/5 shadow-lg overflow-hidden flex flex-col">
								<TimelineEditor
									videoDuration={duration}
									currentTime={currentTime}
									onSeek={handleSeek}
									cursorTelemetry={cursorTelemetry}
									zoomRegions={zoomRegions}
									onZoomAdded={handleZoomAdded}
									onZoomSuggested={handleZoomSuggested}
									onZoomSpanChange={handleZoomSpanChange}
									onZoomDelete={handleZoomDelete}
									selectedZoomId={selectedZoomId}
									onSelectZoom={handleSelectZoom}
									trimRegions={trimRegions}
									onTrimAdded={handleTrimAdded}
									onTrimSpanChange={handleTrimSpanChange}
									onTrimDelete={handleTrimDelete}
									selectedTrimId={selectedTrimId}
									onSelectTrim={handleSelectTrim}
									speedRegions={speedRegions}
									onSpeedAdded={handleSpeedAdded}
									onSpeedSpanChange={handleSpeedSpanChange}
									onSpeedDelete={handleSpeedDelete}
									selectedSpeedId={selectedSpeedId}
									onSelectSpeed={handleSelectSpeed}
									annotationRegions={annotationOnlyRegions}
									onAnnotationAdded={handleAnnotationAdded}
									onAnnotationSpanChange={handleAnnotationSpanChange}
									onAnnotationDelete={handleAnnotationDelete}
									selectedAnnotationId={selectedAnnotationId}
									onSelectAnnotation={handleSelectAnnotation}
									blurRegions={blurRegions}
									onBlurAdded={handleBlurAdded}
									onBlurSpanChange={handleAnnotationSpanChange}
									onBlurDelete={handleAnnotationDelete}
									selectedBlurId={selectedBlurId}
									onSelectBlur={handleSelectBlur}
									aspectRatio={aspectRatio}
									onAspectRatioChange={(ar) =>
										pushState({
											aspectRatio: ar,
											webcamLayoutPreset:
												(isPortraitAspectRatio(ar) && webcamLayoutPreset === "dual-frame") ||
												(!isPortraitAspectRatio(ar) && webcamLayoutPreset === "vertical-stack")
													? "picture-in-picture"
													: webcamLayoutPreset,
										})
									}
								/>
							</div>
						</Panel>
					</PanelGroup>
				</div>

				{/* Right section: settings panel */}
				<div className="flex-[3] min-w-[280px] max-w-[420px] h-full">
					<SettingsPanel
						cursorHighlight={cursorHighlight}
						onCursorHighlightChange={(next) => pushState({ cursorHighlight: next })}
						cursorHighlightSupportsClicks={isMac}
						selected={wallpaper}
						onWallpaperChange={(w) => pushState({ wallpaper: w })}
						selectedZoomDepth={
							selectedZoomId ? zoomRegions.find((z) => z.id === selectedZoomId)?.depth : null
						}
						onZoomDepthChange={(depth) => selectedZoomId && handleZoomDepthChange(depth)}
						selectedZoomFocusMode={
							selectedZoomId
								? (zoomRegions.find((z) => z.id === selectedZoomId)?.focusMode ?? "manual")
								: null
						}
						onZoomFocusModeChange={(mode) => selectedZoomId && handleZoomFocusModeChange(mode)}
						hasCursorTelemetry={cursorTelemetry.length > 0}
						selectedZoomId={selectedZoomId}
						onZoomDelete={handleZoomDelete}
						selectedZoomRotationPreset={
							selectedZoomId
								? (zoomRegions.find((z) => z.id === selectedZoomId)?.rotationPreset ?? null)
								: null
						}
						onZoomRotationPresetChange={handleZoomRotationPresetChange}
						selectedTrimId={selectedTrimId}
						onTrimDelete={handleTrimDelete}
						shadowIntensity={shadowIntensity}
						onShadowChange={(v) => updateState({ shadowIntensity: v })}
						onShadowCommit={commitState}
						showBlur={showBlur}
						onBlurChange={(v) => pushState({ showBlur: v })}
						motionBlurAmount={motionBlurAmount}
						onMotionBlurChange={(v) => updateState({ motionBlurAmount: v })}
						onMotionBlurCommit={commitState}
						borderRadius={borderRadius}
						onBorderRadiusChange={(v) => updateState({ borderRadius: v })}
						onBorderRadiusCommit={commitState}
						padding={padding}
						onPaddingChange={(v) => updateState({ padding: v })}
						onPaddingCommit={commitState}
						cropRegion={cropRegion}
						onCropChange={(r) => pushState({ cropRegion: r })}
						aspectRatio={aspectRatio}
						hasWebcam={Boolean(webcamVideoPath)}
						webcamLayoutPreset={webcamLayoutPreset}
						onWebcamLayoutPresetChange={(preset) =>
							pushState({
								webcamLayoutPreset: preset,
								webcamPosition: preset === "picture-in-picture" ? webcamPosition : null,
							})
						}
						webcamMaskShape={webcamMaskShape}
						onWebcamMaskShapeChange={(shape) => pushState({ webcamMaskShape: shape })}
						webcamSizePreset={webcamSizePreset}
						onWebcamSizePresetChange={(v) => updateState({ webcamSizePreset: v })}
						onWebcamSizePresetCommit={commitState}
						videoElement={videoPlaybackRef.current?.video || null}
						exportQuality={exportQuality}
						onExportQualityChange={setExportQuality}
						exportFormat={exportFormat}
						onExportFormatChange={setExportFormat}
						gifFrameRate={gifFrameRate}
						onGifFrameRateChange={setGifFrameRate}
						gifLoop={gifLoop}
						onGifLoopChange={setGifLoop}
						gifSizePreset={gifSizePreset}
						onGifSizePresetChange={setGifSizePreset}
						gifOutputDimensions={calculateOutputDimensions(
							videoPlaybackRef.current?.video?.videoWidth || 1920,
							videoPlaybackRef.current?.video?.videoHeight || 1080,
							gifSizePreset,
							GIF_SIZE_PRESETS,
							aspectRatio === "native"
								? getNativeAspectRatioValue(
										videoPlaybackRef.current?.video?.videoWidth || 1920,
										videoPlaybackRef.current?.video?.videoHeight || 1080,
										cropRegion,
									)
								: getAspectRatioValue(aspectRatio),
						)}
						onExport={handleOpenExportDialog}
						selectedAnnotationId={selectedAnnotationId}
						annotationRegions={annotationOnlyRegions}
						onAnnotationContentChange={handleAnnotationContentChange}
						onAnnotationTypeChange={handleAnnotationTypeChange}
						onAnnotationStyleChange={handleAnnotationStyleChange}
						onAnnotationFigureDataChange={handleAnnotationFigureDataChange}
						onAnnotationDuplicate={handleAnnotationDuplicate}
						onAnnotationDelete={handleAnnotationDelete}
						selectedBlurId={selectedBlurId}
						blurRegions={blurRegions}
						onBlurDataChange={handleBlurDataPanelChange}
						onBlurDataCommit={commitState}
						onBlurDelete={handleAnnotationDelete}
						selectedSpeedId={selectedSpeedId}
						selectedSpeedValue={
							selectedSpeedId
								? (speedRegions.find((r) => r.id === selectedSpeedId)?.speed ?? null)
								: null
						}
						onSpeedChange={handleSpeedChange}
						onSpeedDelete={handleSpeedDelete}
						unsavedExport={unsavedExport}
						onSaveUnsavedExport={handleSaveUnsavedExport}
					/>
				</div>
			</div>

			<ExportDialog
				isOpen={showExportDialog}
				onClose={() => setShowExportDialog(false)}
				progress={exportProgress}
				isExporting={isExporting}
				error={exportError}
				onCancel={handleCancelExport}
				exportFormat={exportFormat}
				exportedFilePath={exportedFilePath || undefined}
				onShowInFolder={
					exportedFilePath ? () => void handleShowExportedFile(exportedFilePath) : undefined
				}
			/>
		</div>
	);
}
