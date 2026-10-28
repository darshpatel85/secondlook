import path from "node:path";
import { fileURLToPath } from "node:url";

function isMissing(error: unknown, url: URL): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code !== "ERR_MODULE_NOT_FOUND" || typeof message !== "string") return false;
  const file = fileURLToPath(url);
  const stem = path.join(path.dirname(file), path.basename(file, path.extname(file)));
  return message.includes(stem);
}

export async function optionalImport<T extends object>(url: URL): Promise<T | null> {
  try {
    return (await import(url.href)) as T;
  } catch (error) {
    if (isMissing(error, url)) return null;
    throw error;
  }
}
