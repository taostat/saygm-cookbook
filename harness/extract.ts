export type Lang = "typescript" | "python" | "bash";

export interface Region {
  lang: Lang;
  file: string;
  code: string;
}

export interface SnippetFile {
  slug: string;
  regions: Record<string, Region>;
}

export class ExtractError extends Error {
  override name = "ExtractError";
}

const COMMENT: Record<Lang, string> = { typescript: "//", python: "#", bash: "#" };
const EXTENSIONS: Record<string, Lang> = { ".ts": "typescript", ".py": "python", ".sh": "bash" };
const ROLE_HELPER = /\b(?:modelId|model_id)\s*\(/;
const ROLE_CALL = /\b(?:modelId|model_id)\("([^"]*)"\)/g;
const REGION_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function langForFile(file: string): Lang {
  const extension = file.slice(file.lastIndexOf("."));
  const lang = EXTENSIONS[extension];
  if (lang === undefined) {
    throw new ExtractError(`${file}: no snippet language for "${extension}" files`);
  }
  return lang;
}

type Marker = { kind: "open"; id: string } | { kind: "close" };

function parseMarker(line: string, comment: string, where: string): Marker | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith(comment)) {
    return null;
  }
  const body = trimmed.slice(comment.length).trim();
  if (body === "endregion") {
    return { kind: "close" };
  }
  if (!/^(?:end)?region\b/.test(body)) {
    return null;
  }
  const match = /^region: (\S+)$/.exec(body);
  const id = match?.[1];
  if (id === undefined || !REGION_ID.test(id)) {
    throw new ExtractError(
      `${where}: malformed marker "${trimmed}"; use "${comment} region: <id>" with a kebab-case id`,
    );
  }
  return { kind: "open", id };
}

function dedent(lines: string[]): string {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]?.trim() === "") {
    start += 1;
  }
  while (end > start && lines[end - 1]?.trim() === "") {
    end -= 1;
  }
  const body = lines.slice(start, end);
  const indents = body
    .filter((line) => line.trim() !== "")
    .map((line) => /^[ \t]*/.exec(line)?.[0].length ?? 0);
  const margin = Math.min(...indents);
  return body.map((line) => line.slice(Math.min(margin, line.length)).trimEnd()).join("\n");
}

export function extractRegions(source: string, file: string): Array<[string, Region]> {
  const lang = langForFile(file);
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const regions: Array<[string, Region]> = [];
  const seen = new Set<string>();
  let open: { id: string; line: number; body: string[] } | null = null;

  for (const [index, line] of lines.entries()) {
    const where = `${file}:${index + 1}`;
    const marker = parseMarker(line, COMMENT[lang], where);
    if (marker === null) {
      open?.body.push(line);
    } else if (marker.kind === "open") {
      if (open !== null) {
        throw new ExtractError(
          `${where}: region "${marker.id}" opens inside "${open.id}"; regions cannot nest`,
        );
      }
      if (seen.has(marker.id)) {
        throw new ExtractError(`${where}: duplicate region "${marker.id}"`);
      }
      seen.add(marker.id);
      open = { id: marker.id, line: index + 1, body: [] };
    } else {
      if (open === null) {
        throw new ExtractError(`${where}: endregion without an open region`);
      }
      const code = dedent(open.body);
      if (code === "") {
        throw new ExtractError(`${file}:${open.line}: region "${open.id}" is empty`);
      }
      regions.push([open.id, { lang, file, code }]);
      open = null;
    }
  }
  if (open !== null) {
    throw new ExtractError(`${file}:${open.line}: region "${open.id}" is never closed`);
  }
  return regions;
}

// Pages show the model id CI ran, so a copied snippet works without the role helper.
function inlineRoles(id: string, region: Region, roles: Record<string, string>): Region {
  const code = region.code.replaceAll(ROLE_CALL, (_call, role: string) => {
    const model = roles[role];
    if (model === undefined) {
      throw new ExtractError(`${region.file}: region "${id}" uses unknown model role "${role}"`);
    }
    return JSON.stringify(model);
  });
  if (ROLE_HELPER.test(code)) {
    throw new ExtractError(
      `${region.file}: region "${id}" calls a model role helper that cannot be replaced; ` +
        'write it as modelId("<role>")',
    );
  }
  return { ...region, code };
}

export function buildSnippetFile(
  slug: string,
  roles: Record<string, string>,
  files: Array<{ file: string; source: string }>,
): SnippetFile {
  const regions: Record<string, Region> = {};
  for (const { file, source } of files) {
    for (const [id, region] of extractRegions(source, file)) {
      const first = regions[id];
      if (first !== undefined) {
        throw new ExtractError(
          `${file}: duplicate region "${id}" (first defined in ${first.file})`,
        );
      }
      regions[id] = inlineRoles(id, region, roles);
    }
  }
  if (Object.keys(regions).length === 0) {
    throw new ExtractError(`example "${slug}" has no regions; mark the code the tutorial shows`);
  }
  return { slug, regions };
}
