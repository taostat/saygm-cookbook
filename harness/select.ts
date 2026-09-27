const SHARED_PREFIXES = ["harness/", "shared/", ".github/workflows/examples.yml"];
const SHARED_FILES = new Set([
  "catalog.json",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "pyproject.toml",
  "tsconfig.base.json",
  "tsconfig.json",
  "uv.lock",
]);

export function selectExamples(changedPaths: string[], allSlugs: string[]): string[] {
  const known = new Set(allSlugs);
  const selected = new Set<string>();
  for (const path of changedPaths) {
    if (SHARED_FILES.has(path) || SHARED_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      return allSlugs.toSorted();
    }
    const slug = /^examples\/([^/]+)\//.exec(path)?.[1];
    if (slug !== undefined && known.has(slug)) {
      selected.add(slug);
    }
  }
  return [...selected].toSorted();
}
