import { spawnSync } from "node:child_process";
import process from "node:process";

const nativeModules = ["node-pty"];

// uiohook-napi click capture is macOS-only at runtime (gated in
// electron/ipc/handlers.ts). Skip that rebuild on other platforms so CI runners
// without X11 dev headers don't fail npm install.
if (process.platform === "darwin") {
	nativeModules.push("uiohook-napi");
} else {
	console.log(
		`[rebuild:native] Skipping uiohook-napi rebuild on ${process.platform} (macOS-only).`,
	);
}

for (const nativeModule of nativeModules) {
	const result = spawnSync(
		process.execPath,
		["./node_modules/@electron/rebuild/lib/cli.js", "--force", "--only", nativeModule],
		{ stdio: "inherit" },
	);
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}
