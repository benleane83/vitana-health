import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export interface SourceManifestEntry {
  path: string;
  bytes: number;
  sha256: string;
}

export interface SourceManifest {
  version: 1;
  createdAt: string;
  sourceRoot: string;
  files: SourceManifestEntry[];
}

export interface CopiedDataValidationContext {
  inputCopyDir: string;
  manifestPath: string;
  sourceManifest: SourceManifest;
}

export async function withCopiedDataValidation<T>(
  options: { sourceDir: string; workRoot: string },
  validate: (context: CopiedDataValidationContext) => Promise<T>
): Promise<T> {
  const sourceDir = resolve(options.sourceDir);
  const workRoot = resolve(options.workRoot);
  assertIsolatedRoots(sourceDir, workRoot);
  if (existsSync(workRoot)) {
    throw new Error(`Copied-data validation work root already exists: ${workRoot}.`);
  }

  const files = inventoryTree(sourceDir);
  const sourceManifest: SourceManifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    sourceRoot: sourceDir,
    files
  };
  const inputCopyDir = join(workRoot, "input-copy");
  const manifestPath = join(workRoot, "source-manifest.json");
  mkdirSync(inputCopyDir, { recursive: true });
  for (const entry of files) {
    const destination = join(inputCopyDir, entry.path);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(sourceDir, entry.path), destination);
  }
  assertManifestMatches(inputCopyDir, files, "Copied input");
  assertManifestMatches(sourceDir, files, "Source");
  writeFileSync(manifestPath, `${JSON.stringify(sourceManifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });

  try {
    return await validate({ inputCopyDir, manifestPath, sourceManifest });
  } finally {
    assertManifestMatches(sourceDir, files, "Source after copied-data validation");
  }
}

function inventoryTree(root: string): SourceManifestEntry[] {
  assertOrdinaryDirectory(root);
  const files: SourceManifestEntry[] = [];
  visit(root, "");
  return files.sort((left, right) => left.path.localeCompare(right.path));

  function visit(directory: string, relativeDirectory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relativePath = relativeDirectory ? join(relativeDirectory, entry.name) : entry.name;
      const absolutePath = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Copied-data validation refuses links or junctions: ${absolutePath}.`);
      }
      if (entry.isDirectory()) {
        assertOrdinaryDirectory(absolutePath);
        visit(absolutePath, relativePath);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`Copied-data validation refuses non-file entries: ${absolutePath}.`);
      }
      const bytes = readFileSync(absolutePath);
      files.push({
        path: relativePath,
        bytes: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex")
      });
    }
  }
}

function assertManifestMatches(root: string, expected: SourceManifestEntry[], label: string): void {
  const actual = inventoryTree(root);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} no longer matches the source manifest.`);
  }
}

function assertOrdinaryDirectory(path: string): void {
  const stats = lstatSync(path);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`Copied-data validation requires an ordinary directory: ${path}.`);
  }
}

function assertIsolatedRoots(sourceDir: string, workRoot: string): void {
  if (sourceDir === workRoot || isWithin(sourceDir, workRoot) || isWithin(workRoot, sourceDir)) {
    throw new Error("Copied-data validation source and work roots must not overlap.");
  }
}

function isWithin(parent: string, child: string): boolean {
  const candidate = relative(parent, child);
  return candidate !== "" && !candidate.startsWith("..") && !isAbsolute(candidate);
}