import { convertFileSrc, invoke } from "@tauri-apps/api/core";

export type PasteMode = "rich" | "plain" | "filesAsPaths";

export type ClipboardItemCommandInput = {
  id: string;
  pasteMode?: PasteMode;
  source?: string;
};

export type ClipboardCapturePayload<TItem> = {
  status: "created" | "promoted";
  item: TItem;
};

export type FilePathStatus = {
  path: string;
  exists: boolean;
  isFile: boolean;
  isDir: boolean;
};

export function readClipboard<TItem>(
  input: { sourceLabel?: string; observedAt?: number } = {},
): Promise<ClipboardCapturePayload<TItem>> {
  return invoke<ClipboardCapturePayload<TItem>>("capture_current_clipboard", {
    sourceLabel: input.sourceLabel ?? "Clipboard",
    observedAt: input.observedAt ?? Date.now(),
  });
}

export function writeClipboard<TItem>(input: ClipboardItemCommandInput): Promise<Partial<TItem>> {
  return invoke<Partial<TItem>>("write_clipboard_item", { input });
}

export function pasteClipboard<TItem>(input: ClipboardItemCommandInput): Promise<Partial<TItem>> {
  return invoke<Partial<TItem>>("paste_clipboard_item", { input });
}

export function checkFilePaths(paths: string[]): Promise<FilePathStatus[]> {
  return invoke<FilePathStatus[]>("check_file_paths", { paths });
}

export function getImagePath(path: string | null | undefined) {
  if (!path) return null;
  if (/^(data:|https?:|asset:|http:\/\/asset\.localhost)/i.test(path)) return path;
  return convertFileSrc(path);
}
