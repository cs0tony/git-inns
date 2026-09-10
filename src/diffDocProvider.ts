import * as vscode from "vscode";

import { DataSource } from "./dataSource";
import { decodeGitBytes, normalizeFileEncoding } from "./fileEncoding";
import { getPathFromStr } from "./utils";

export class DiffDocProvider implements vscode.TextDocumentContentProvider {
  public static scheme = "git-keizu";
  private dataSource: DataSource;
  private onDidChangeEventEmitter = new vscode.EventEmitter<vscode.Uri>();
  private docs = new Map<string, DiffDocument>();
  private subscriptions: vscode.Disposable;

  constructor(dataSource: DataSource) {
    this.dataSource = dataSource;
    this.subscriptions = vscode.workspace.onDidCloseTextDocument((doc) =>
      this.docs.delete(doc.uri.toString())
    );
  }

  public dispose() {
    this.subscriptions.dispose();
    this.docs.clear();
    this.onDidChangeEventEmitter.dispose();
  }

  get onDidChange() {
    return this.onDidChangeEventEmitter.event;
  }

  public async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    let existing = this.docs.get(uri.toString());
    if (existing) return existing.value;

    const request = decodeDiffDocUri(uri);
    const data = await this.dataSource.getCommitFileRaw(
      request.repo,
      request.commit,
      request.filePath
    );
    const document = new DiffDocument(decodeGitBytes(data, request.encoding));
    this.docs.set(uri.toString(), document);
    return document.value;
  }
}

class DiffDocument {
  private body: string;

  constructor(body: string) {
    this.body = body;
  }

  get value() {
    return this.body;
  }
}

export function encodeDiffDocUri(
  repo: string,
  filePath: string,
  commit: string,
  version?: string,
  encoding?: string
): vscode.Uri {
  const queryFields = [`commit=${encodeURIComponent(commit)}`, `repo=${encodeURIComponent(repo)}`];
  const normalizedEncoding = normalizeFileEncoding(encoding);
  queryFields.splice(1, 0, `encoding=${encodeURIComponent(normalizedEncoding)}`);
  if (version !== undefined) {
    queryFields.push(`version=${encodeURIComponent(version)}`);
  }
  return vscode.Uri.from({
    scheme: DiffDocProvider.scheme,
    path: getPathFromStr(filePath),
    query: queryFields.join("&")
  });
}

export function decodeDiffDocUri(uri: vscode.Uri) {
  const queryArgs = decodeUriQueryArgs(uri.query);
  return {
    filePath: uri.path,
    commit: queryArgs.commit,
    repo: queryArgs.repo,
    encoding: normalizeFileEncoding(queryArgs.encoding)
  };
}

function decodeUriQueryArgs(query: string) {
  const queryComps = query.split("&");
  const queryArgs: { [key: string]: string } = {};
  for (let i = 0; i < queryComps.length; i++) {
    const pair = queryComps[i].split("=");
    queryArgs[pair[0]] = pair[1] !== undefined ? decodeURIComponent(pair[1]) : "";
  }
  return queryArgs;
}
