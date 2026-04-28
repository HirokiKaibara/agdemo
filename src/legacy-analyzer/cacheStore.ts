import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import type { CachedArtifact } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..");
const cacheRoot = path.join(projectRoot, ".cache", "legacy-analysis");
const cacheVersion = "v2";

type CacheBucket = "function-summaries" | "file-summaries" | "project-analyses";

function getBucketDir(bucket: CacheBucket): string {
  return path.join(cacheRoot, bucket);
}

async function ensureBucket(bucket: CacheBucket): Promise<string> {
  const dir = getBucketDir(bucket);
  await mkdir(dir, { recursive: true });
  return dir;
}

function getArtifactPath(bucket: CacheBucket, hash: string): string {
  return path.join(getBucketDir(bucket), `${hash}.json`);
}

export function buildHash(...values: string[]): string {
  const hash = createHash("sha256");
  hash.update(cacheVersion);

  for (const value of values) {
    hash.update("\n---\n");
    hash.update(value);
  }

  return hash.digest("hex");
}

export async function readCachedArtifact<T>(
  bucket: CacheBucket,
  hash: string
): Promise<CachedArtifact<T> | null> {
  try {
    const artifactPath = getArtifactPath(bucket, hash);
    const content = await readFile(artifactPath, "utf8");
    return JSON.parse(content) as CachedArtifact<T>;
  } catch {
    return null;
  }
}

export async function writeCachedArtifact<T>(
  bucket: CacheBucket,
  artifact: CachedArtifact<T>
): Promise<void> {
  const dir = await ensureBucket(bucket);
  const artifactPath = path.join(dir, `${artifact.hash}.json`);
  await writeFile(artifactPath, JSON.stringify(artifact, null, 2), "utf8");
}
