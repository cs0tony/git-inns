import { UNCOMMITTED_CHANGES_HASH } from "./types";

const COMMIT_HASH_PATTERN = /^[0-9a-f]{4,40}$/i;
const isValidCommitHash = (hash: string): boolean => COMMIT_HASH_PATTERN.test(hash);

/**
 * Builds safe argv for an external directory diff. The sentinel is accepted only in
 * the from-position used by GitKeizuView.getCommitOrder, where it means "working tree".
 */
export function buildExternalDirDiffArgs(fromHash: string, toHash: string): string[] | null {
  const isFromUncommitted = fromHash === UNCOMMITTED_CHANGES_HASH;
  const isToUncommitted = toHash === UNCOMMITTED_CHANGES_HASH;

  if (isToUncommitted && !isFromUncommitted) return null;
  if (!isFromUncommitted && !isValidCommitHash(fromHash)) return null;
  if (!isToUncommitted && !isValidCommitHash(toHash)) return null;

  if (isFromUncommitted) {
    if (isToUncommitted) return ["difftool", "--dir-diff", "HEAD"];
    return ["difftool", "--dir-diff", toHash];
  }

  if (fromHash === toHash) {
    return ["difftool", "--dir-diff", `${fromHash}^..${fromHash}`];
  }

  return ["difftool", "--dir-diff", `${fromHash}..${toHash}`];
}

const SAFE_TERMINAL_ARGUMENT = /^[A-Za-z0-9@^._/-]+$/;

function quoteTerminalArgument(value: string): string {
  if (SAFE_TERMINAL_ARGUMENT.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** Builds a display/send command string; repository-controlled values are never interpolated raw. */
export function buildQuotedExternalDiffCommand(args: string[]): string {
  return ["git", ...args].map(quoteTerminalArgument).join(" ");
}
