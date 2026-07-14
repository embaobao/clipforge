export type SearchClipPayloadKind =
  | "text"
  | "link"
  | "markdown"
  | "code"
  | "command"
  | "html"
  | "rtf"
  | "file"
  | "image"
  | "json"
  | "chart"
  | "table";

export type ClipTypeFilter = "all" | SearchClipPayloadKind;

export type SearchSuggestion =
  | { id: string; label: string; hint: string; kind: "all"; typeFilter: "all" }
  | { id: string; label: string; hint: string; kind: "favorite" }
  | { id: string; label: string; hint: string; kind: "type"; typeFilter: SearchClipPayloadKind }
  | { id: string; label: string; hint: string; kind: "saved"; tag: string };

export type SearchQueryAst = {
  text: string;
  bucket: "all" | "history" | "archive" | "snippet" | "trash";
  kinds: string[];
  types: SearchClipPayloadKind[];
  tags: string[];
  fileExtensions: string[];
  favorite: boolean;
  invalidTokens: string[];
  labels: string[];
};

export type ParsedSearchCommand = {
  handled: boolean;
  queryText: string;
  typeFilter: ClipTypeFilter;
  filterFavorite: boolean;
  tag: string | null;
  label: string | null;
  ast: SearchQueryAst;
};

export const CLIP_PAYLOAD_KIND_VALUES = [
  "text",
  "link",
  "markdown",
  "code",
  "command",
  "html",
  "rtf",
  "file",
  "image",
  "json",
  "chart",
  "table",
] as const satisfies readonly SearchClipPayloadKind[];

export function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeTagName(value: string): string | null {
  const tag = value.trim().replace(/^#/, "").replace(/^tag:/i, "").trim();
  if (!tag) return null;
  return tag.slice(0, 32);
}

export function getSearchSuggestionToken(suggestion: SearchSuggestion) {
  if (suggestion.kind === "all") return "@全部";
  if (suggestion.kind === "favorite") return "@收藏";
  if (suggestion.kind === "saved") return `@${suggestion.label}`;
  const tokenMap: Record<SearchClipPayloadKind, string> = {
    text: "@text:",
    code: "@code:",
    link: "@link:",
    markdown: "@md:",
    command: "@cmd:",
    json: "@json:",
    chart: "@chart:",
    table: "@table:",
    html: "@html:",
    rtf: "@rtf:",
    file: "@file:",
    image: "@img:",
  };
  return tokenMap[suggestion.typeFilter];
}

export function getSearchSuggestionAliases(suggestion: SearchSuggestion) {
  const label = suggestion.label.toLowerCase();
  if (suggestion.kind === "all") return [label, "all", "全部", "全部内容"];
  if (suggestion.kind === "favorite") return [label, "fav", "favorite", "favorites", "star", "收藏"];
  if (suggestion.kind === "saved") return [label, suggestion.tag.toLowerCase()];
  const aliasMap: Record<SearchClipPayloadKind, string[]> = {
    text: ["text", "txt", "文本"],
    code: ["code", "代码"],
    link: ["link", "url", "links", "链接"],
    markdown: ["md", "markdown"],
    command: ["cmd", "command", "shell", "命令"],
    json: ["json", "结构化"],
    chart: ["chart", "图表"],
    table: ["table", "表格", "tsv", "csv"],
    html: ["html", "富文本"],
    rtf: ["rtf", "richtext", "富文本"],
    file: ["file", "files", "文件", "路径"],
    image: ["image", "img", "图片"],
  };
  return [label, ...aliasMap[suggestion.typeFilter]];
}

export function matchesSearchSuggestionToken(
  suggestion: SearchSuggestion,
  rawToken: string,
  matchLabel?: (label: string, term: string) => boolean,
) {
  const term = normalizeSearch(rawToken.replace(/^@/, ""));
  if (!term) return true;
  const aliases = getSearchSuggestionAliases(suggestion);
  return aliases.some((alias) => alias.includes(term)) || Boolean(matchLabel?.(suggestion.label, term));
}

export function createEmptySearchAst(rawText = ""): SearchQueryAst {
  return {
    text: rawText,
    bucket: "all",
    kinds: [],
    types: [],
    tags: [],
    fileExtensions: [],
    favorite: false,
    invalidTokens: [],
    labels: [],
  };
}

function addUnique<T extends string>(values: T[], value: T) {
  if (!values.some((item) => item.toLowerCase() === value.toLowerCase())) {
    values.push(value);
  }
}

function isClipPayloadKind(value: string): value is SearchClipPayloadKind {
  return CLIP_PAYLOAD_KIND_VALUES.includes(value as SearchClipPayloadKind);
}

export function parseSearchCommand(rawQuery: string, suggestions: SearchSuggestion[]): ParsedSearchCommand {
  const ast = createEmptySearchAst(rawQuery);
  const fallback: ParsedSearchCommand = {
    handled: false,
    queryText: rawQuery,
    typeFilter: "all",
    filterFavorite: false,
    tag: null,
    label: null,
    ast,
  };
  const tokens = rawQuery.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return fallback;

  const textTokens: string[] = [];
  let handled = false;
  for (const token of tokens) {
    const normalizedToken = normalizeSearch(token);
    if (token.startsWith("#")) {
      const tag = normalizeTagName(token);
      if (tag) {
        addUnique(ast.tags, tag);
        ast.labels.push(`#${tag}`);
        handled = true;
        continue;
      }
    }

    const keyed = token.match(/^(tag|type|kind|file|ext|bucket):(.+)$/i);
    if (keyed) {
      const key = keyed[1].toLowerCase();
      const value = keyed[2].trim();
      if (key === "tag") {
        const tag = normalizeTagName(value);
        if (tag) {
          addUnique(ast.tags, tag);
          ast.labels.push(`#${tag}`);
          handled = true;
          continue;
        }
      }
      if (key === "type") {
        const type = normalizeSearch(value);
        if (isClipPayloadKind(type)) {
          addUnique(ast.types, type);
          ast.labels.push(`type:${type}`);
          handled = true;
          continue;
        }
      }
      if (key === "kind") {
        const kind = normalizeSearch(value) === "url" ? "link" : normalizeSearch(value);
        if (kind) {
          addUnique(ast.kinds, kind);
          ast.labels.push(`kind:${normalizeSearch(value)}`);
          handled = true;
          continue;
        }
      }
      if (key === "file" || key === "ext") {
        const extension = value.replace(/^\./, "").toLowerCase();
        if (extension) {
          addUnique(ast.fileExtensions, extension);
          ast.labels.push(`file:${extension}`);
          handled = true;
          continue;
        }
      }
      if (key === "bucket") {
        const bucket = normalizeSearch(value);
        if (bucket === "all" || bucket === "history" || bucket === "archive" || bucket === "snippet" || bucket === "trash") {
          ast.bucket = bucket;
          ast.labels.push(`bucket:${bucket}`);
          handled = true;
          continue;
        }
      }
      ast.invalidTokens.push(token);
      handled = true;
      continue;
    }

    if (normalizedToken === "favorite" || normalizedToken === "fav" || normalizedToken === "收藏" || normalizedToken === "@favorite") {
      ast.favorite = true;
      ast.labels.push("@favorite");
      handled = true;
      continue;
    }

    if (token.startsWith("@")) {
      const command = normalizeSearch(token.slice(1)).replace(/:$/, "");
      const matched = suggestions.find((suggestion) =>
        getSearchSuggestionAliases(suggestion).some((alias) => alias === command),
      );
      if (matched) {
        if (matched.kind === "favorite") {
          ast.favorite = true;
        } else if (matched.kind === "type") {
          addUnique(ast.types, matched.typeFilter);
        } else if (matched.kind === "saved") {
          addUnique(ast.tags, matched.tag);
        }
        if (matched.kind !== "all") ast.labels.push(getSearchSuggestionToken(matched));
        handled = true;
        continue;
      }
      ast.invalidTokens.push(token);
      handled = true;
      continue;
    }

    textTokens.push(token);
  }

  ast.text = textTokens.join(" ");
  const typeFilter = ast.types[0] ?? "all";
  const tag = ast.tags[0] ?? null;
  return {
    handled,
    queryText: ast.text,
    typeFilter,
    filterFavorite: ast.favorite,
    tag,
    label: ast.labels[0] ?? ast.invalidTokens[0] ?? null,
    ast,
  };
}
