import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
export const ROOT = fileURLToPath(new URL('./', import.meta.url));
export const DATA = process.env.FIGMA_BRIDGE_DATA_DIR ? resolve(process.env.FIGMA_BRIDGE_DATA_DIR) : resolve(ROOT,'.local');
export const PORT = Number(process.env.FIGMA_BRIDGE_PORT || 4318);
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) throw new Error('Invalid bridge port');
export const URL_BASE = `http://127.0.0.1:${PORT}`;
export const SESSION_FILE = resolve(DATA,'session.json');
export const CREDENTIAL_FILE = resolve(DATA,'credentials.json');
