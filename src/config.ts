import path from "path";

export const SERVER_PORT = 41234;
export const SEGMENT_SIZE = 1400;
export const CONNECTION_TIMEOUT_MS = 5000;
export const RETRANSMIT_TIMEOUT_MS = 3000;
export const MAX_RETRANSMIT_ATTEMPTS = 5;
export const FILES_DIR = path.join(process.cwd(), "files");
export const DOWNLOADS_DIR = path.join(process.cwd(), "downloads");
