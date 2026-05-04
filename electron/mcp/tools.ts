import { annotationToolDefinitions } from "./annotationTools";
import { blurToolDefinitions } from "./blurTools";
import { cropToolDefinitions } from "./cropTools";
import { cursorHighlightToolDefinitions } from "./cursorHighlightTools";
import { exportToolDefinitions } from "./exportTools";
import { layoutEffectsToolDefinitions } from "./layoutEffectsTools";
import { previewDirectToolDefinitions } from "./previewDirectTools";
import { projectMediaToolDefinitions } from "./projectMediaTools";
import { recordingHudToolDefinitions } from "./recordingHudTools";
import { shortcutsPreferencesToolDefinitions } from "./shortcutsPreferencesTools";
import { timelineToolDefinitions } from "./timelineTools";

export const mcpToolDefinitions = [
	...recordingHudToolDefinitions,
	...projectMediaToolDefinitions,
	...timelineToolDefinitions,
	...previewDirectToolDefinitions,
	...layoutEffectsToolDefinitions,
	...cropToolDefinitions,
	...cursorHighlightToolDefinitions,
	...annotationToolDefinitions,
	...blurToolDefinitions,
	...exportToolDefinitions,
	...shortcutsPreferencesToolDefinitions,
];

export type { AnnotationToolContext } from "./annotationTools";
export type { BlurToolContext } from "./blurTools";
export type { CropToolContext } from "./cropTools";
export type { CursorHighlightToolContext } from "./cursorHighlightTools";
export type { ExportToolContext } from "./exportTools";
export type { LayoutEffectsToolContext } from "./layoutEffectsTools";
export type { PreviewDirectToolContext } from "./previewDirectTools";
export type { ProjectMediaToolContext } from "./projectMediaTools";
export type { RecordingHudToolContext } from "./recordingHudTools";
export type { ShortcutsPreferencesToolContext } from "./shortcutsPreferencesTools";
export type { TimelineToolContext } from "./timelineTools";
export type { McpToolDefinition, McpToolResult, RendererCommandBus } from "./toolTypes";
export type OpenScreenMcpToolContext = import("./recordingHudTools").RecordingHudToolContext &
	import("./projectMediaTools").ProjectMediaToolContext &
	import("./timelineTools").TimelineToolContext &
	import("./previewDirectTools").PreviewDirectToolContext &
	import("./layoutEffectsTools").LayoutEffectsToolContext &
	import("./cropTools").CropToolContext &
	import("./cursorHighlightTools").CursorHighlightToolContext &
	import("./annotationTools").AnnotationToolContext &
	import("./blurTools").BlurToolContext &
	import("./exportTools").ExportToolContext &
	import("./shortcutsPreferencesTools").ShortcutsPreferencesToolContext;
export {
	annotationToolDefinitions,
	blurToolDefinitions,
	cropToolDefinitions,
	cursorHighlightToolDefinitions,
	exportToolDefinitions,
	layoutEffectsToolDefinitions,
	previewDirectToolDefinitions,
	projectMediaToolDefinitions,
	recordingHudToolDefinitions,
	shortcutsPreferencesToolDefinitions,
	timelineToolDefinitions,
};
