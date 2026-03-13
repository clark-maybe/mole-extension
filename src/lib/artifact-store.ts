/**
 * 本地 artifact 存储（用于截图等大体积结果，避免挤占 LLM 上下文）
 */

export interface ScreenshotArtifactRecord {
  id: string;
  kind: 'screenshot';
  format: 'png' | 'jpeg';
  dataUrl: string;
  sizeKB: number;
  createdAt: number;
}

const ARTIFACT_STORAGE_KEY = 'mole_artifacts_v1';
const MAX_ARTIFACTS = 24;
const EXPIRE_MS = 24 * 60 * 60 * 1000;

let writeQueue: Promise<void> = Promise.resolve();
const memoryCache = new Map<string, ScreenshotArtifactRecord>();

const nowTs = () => Date.now();

const readAll = async (): Promise<ScreenshotArtifactRecord[]> => {
  const result = await chrome.storage.local.get(ARTIFACT_STORAGE_KEY);
  const raw = result[ARTIFACT_STORAGE_KEY];
  if (!Array.isArray(raw)) return [];
  return raw as ScreenshotArtifactRecord[];
};

const writeAll = async (list: ScreenshotArtifactRecord[]): Promise<void> => {
  await chrome.storage.local.set({ [ARTIFACT_STORAGE_KEY]: list });
};

const compactArtifacts = (list: ScreenshotArtifactRecord[]): ScreenshotArtifactRecord[] => {
  const deadline = nowTs() - EXPIRE_MS;
  const filtered = list
    .filter((item) => item?.id && item.createdAt >= deadline)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_ARTIFACTS);
  return filtered;
};

const runWrite = async (writer: (list: ScreenshotArtifactRecord[]) => Promise<ScreenshotArtifactRecord[]> | ScreenshotArtifactRecord[]): Promise<void> => {
  const next = writeQueue.then(async () => {
    const current = compactArtifacts(await readAll());
    const written = compactArtifacts(await writer(current));
    await writeAll(written);
    memoryCache.clear();
    written.forEach((item) => memoryCache.set(item.id, item));
  });

  writeQueue = next.then(() => undefined, () => undefined);
  return next;
};

export const ArtifactStore = {
  async saveScreenshot(dataUrl: string, format: 'png' | 'jpeg', sizeKB: number): Promise<ScreenshotArtifactRecord> {
    const record: ScreenshotArtifactRecord = {
      id: `artifact_ss_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      kind: 'screenshot',
      format,
      dataUrl,
      sizeKB,
      createdAt: nowTs(),
    };

    await runWrite(async (list) => [record, ...list.filter((item) => item.id !== record.id)]);
    return record;
  },

  async getScreenshot(artifactId: string): Promise<ScreenshotArtifactRecord | null> {
    const fromCache = memoryCache.get(artifactId);
    if (fromCache) return fromCache;

    const list = compactArtifacts(await readAll());
    list.forEach((item) => memoryCache.set(item.id, item));
    const found = list.find((item) => item.id === artifactId);
    return found || null;
  },
};
