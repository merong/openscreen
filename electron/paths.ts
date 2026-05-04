import path from "node:path";
import { app } from "electron";

export const RECORDINGS_DIR = path.join(app.getPath("userData"), "recordings");
