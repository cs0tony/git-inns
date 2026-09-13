import { randomBytes, timingSafeEqual } from "node:crypto";
import * as fs from "node:fs/promises";
import * as http from "node:http";
import type * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

import {
  ASKPASS_ENTRYPOINT_NAME,
  ASKPASS_MAIN_SCRIPT_NAME,
  createAskpassEntrypoint,
  createEmptyAskpassEntrypoint,
  createPosixAskpassEntrypoint,
  createWindowsAskpassEntrypoint,
  EMPTY_ASKPASS_ENTRYPOINT_NAME,
  EMPTY_ASKPASS_MAIN_SCRIPT_NAME,
  WINDOWS_ASKPASS_ENTRYPOINT_NAME,
  WINDOWS_EMPTY_ASKPASS_ENTRYPOINT_NAME
} from "./entrypoints";

const MAX_PROMPT_LENGTH = 4096;
const MAX_REQUEST_LENGTH = 8192;
const NONCE_HEADER = "x-git-keizu-askpass-nonce";
const PASSWORD_PROMPT_PATTERN = /pass(?:word|phrase)|pin|secret|token/i;

type VSCodeModule = typeof import("vscode");

export interface AskpassPromptOptions {
  password: boolean;
  ignoreFocusOut: true;
  prompt: string;
}

export type AskpassPrompt = (options: AskpassPromptOptions) => Promise<string | undefined>;

export interface AskpassManagerLike {
  start(): Promise<void>;
  stop(): Promise<void>;
  getEnvironment(): NodeJS.ProcessEnv;
  isReady(): boolean;
}

type AskpassState = "inactive" | "starting" | "ready" | "empty";
type AskpassServerFactory = (handler: http.RequestListener) => net.Server;

function isReferencePromptRequest(value: unknown): value is { prompt: string } {
  if (Object.prototype.toString.call(value) !== "[object Object]") return false;
  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.length !== 1 || keys[0] !== "prompt") return false;
  const prompt = (value as { prompt?: unknown }).prompt;
  return typeof prompt === "string" && prompt !== "" && prompt.length <= MAX_PROMPT_LENGTH;
}

function noncesMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isPasswordPrompt(prompt: string): boolean {
  return PASSWORD_PROMPT_PATTERN.test(prompt);
}

async function promptWithVSCode(options: AskpassPromptOptions): Promise<string | undefined> {
  const vscode: VSCodeModule = await import("vscode");
  return vscode.window.showInputBox(options);
}

export class AskpassManager implements AskpassManagerLike {
  private endpoint = "";
  private nonce = "";
  private runtimeDirectory = "";
  private server: net.Server | undefined;
  private startPromise: Promise<void> | undefined;
  private state: AskpassState = "inactive";
  private emptyAskpassPath = "";
  private askpassPath = "";
  private askpassScriptPath = "";

  constructor(
    private readonly createServer: AskpassServerFactory = http.createServer,
    private readonly prompt: AskpassPrompt = promptWithVSCode
  ) {}

  public async start(): Promise<void> {
    if (this.state === "ready") return;
    this.startPromise ??= this.initialize();
    await this.startPromise;
  }

  public async stop(): Promise<void> {
    await this.startPromise;
    this.startPromise = undefined;
    const server = this.server;
    this.server = undefined;
    await new Promise<void>((resolve) => {
      if (server === undefined) {
        resolve();
        return;
      }
      server.close(() => resolve());
    });
    const runtimeDirectory = this.runtimeDirectory;
    this.runtimeDirectory = "";
    this.endpoint = "";
    this.nonce = "";
    this.askpassPath = "";
    this.askpassScriptPath = "";
    this.emptyAskpassPath = "";
    this.state = "inactive";
    if (runtimeDirectory !== "") {
      await fs.rm(runtimeDirectory, { recursive: true, force: true });
    }
  }

  public getEnvironment(): NodeJS.ProcessEnv {
    if (this.state !== "ready" && this.state !== "empty") {
      return { ...process.env };
    }
    const askpassPath = this.state === "ready" ? this.askpassPath : this.emptyAskpassPath;
    return {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      GIT_ASKPASS: askpassPath,
      GIT_KEIZU_NODE: process.execPath,
      GIT_TERMINAL_PROMPT: "0",
      SSH_ASKPASS: askpassPath,
      SSH_ASKPASS_REQUIRE: "force"
    };
  }

  public isReady(): boolean {
    return this.state === "ready";
  }

  private async initialize(): Promise<void> {
    this.state = "starting";
    const nonce = randomBytes(32).toString("base64url");
    let endpoint: string;
    let runtimeDirectory: string;

    try {
      runtimeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "git-keizu-askpass-"));
      await fs.chmod(runtimeDirectory, 0o700);
      endpoint =
        process.platform === "win32"
          ? `\\\\.\\pipe\\git-keizu-askpass-${randomBytes(16).toString("hex")}`
          : path.join(runtimeDirectory, "askpass.sock");

      this.runtimeDirectory = runtimeDirectory;
      this.nonce = nonce;
      this.endpoint = endpoint;
      const askpassScriptPath = path.join(runtimeDirectory, ASKPASS_MAIN_SCRIPT_NAME);
      const emptyAskpassScriptPath = path.join(runtimeDirectory, EMPTY_ASKPASS_MAIN_SCRIPT_NAME);
      this.askpassScriptPath = askpassScriptPath;
      this.askpassPath = path.join(runtimeDirectory, this.entrypointName());
      this.emptyAskpassPath = path.join(runtimeDirectory, this.emptyEntrypointName());

      await Promise.all([
        fs.writeFile(askpassScriptPath, createAskpassEntrypoint(endpoint, nonce), {
          mode: 0o700
        }),
        fs.writeFile(emptyAskpassScriptPath, createEmptyAskpassEntrypoint(), { mode: 0o700 }),
        process.platform === "win32"
          ? Promise.all([
              fs.writeFile(
                path.join(runtimeDirectory, WINDOWS_ASKPASS_ENTRYPOINT_NAME),
                createWindowsAskpassEntrypoint(ASKPASS_MAIN_SCRIPT_NAME)
              ),
              fs.writeFile(
                path.join(runtimeDirectory, WINDOWS_EMPTY_ASKPASS_ENTRYPOINT_NAME),
                createWindowsAskpassEntrypoint(EMPTY_ASKPASS_MAIN_SCRIPT_NAME)
              )
            ])
          : Promise.all([
              fs.writeFile(
                this.askpassPath,
                createPosixAskpassEntrypoint(ASKPASS_MAIN_SCRIPT_NAME),
                { mode: 0o700 }
              ),
              fs.writeFile(
                this.emptyAskpassPath,
                createPosixAskpassEntrypoint(EMPTY_ASKPASS_MAIN_SCRIPT_NAME),
                { mode: 0o700 }
              )
            ])
      ]);

      await this.listen();
      this.state = "ready";
    } catch {
      await this.degradeToEmpty();
      this.state = "empty";
    }
  }

  private entrypointName(): string {
    return process.platform === "win32" ? WINDOWS_ASKPASS_ENTRYPOINT_NAME : ASKPASS_ENTRYPOINT_NAME;
  }

  private emptyEntrypointName(): string {
    return process.platform === "win32"
      ? WINDOWS_EMPTY_ASKPASS_ENTRYPOINT_NAME
      : EMPTY_ASKPASS_ENTRYPOINT_NAME;
  }

  private listen(): Promise<void> {
    const server = this.createServer((request, response) => {
      void this.handleRequest(request, response);
    });
    server.on("error", () => {
      if (this.state === "ready") void this.degradeToEmpty();
    });
    this.server = server;

    return new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.endpoint, () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
  }

  private async degradeToEmpty(): Promise<void> {
    this.state = "empty";
    const server = this.server;
    this.server = undefined;
    await new Promise<void>((resolve) => {
      if (server === undefined) {
        resolve();
        return;
      }
      server.close(() => resolve());
    });
    this.server = undefined;
    const endpoint = this.endpoint;
    this.endpoint = "";
    const askpassPath = this.askpassPath;
    this.askpassPath = "";
    const askpassScriptPath = this.askpassScriptPath;
    this.askpassScriptPath = "";
    await Promise.allSettled([
      process.platform === "win32" ? Promise.resolve() : fs.unlink(endpoint),
      askpassPath === "" ? Promise.resolve() : fs.unlink(askpassPath),
      askpassScriptPath === "" ? Promise.resolve() : fs.unlink(askpassScriptPath)
    ]);
  }

  private async handleRequest(
    request: http.IncomingMessage,
    response: http.ServerResponse
  ): Promise<void> {
    response.setHeader("cache-control", "no-store");
    try {
      const nonce = request.headers[NONCE_HEADER];
      const requestNonce = Array.isArray(nonce) ? nonce[0] : nonce;
      if (
        request.method !== "POST" ||
        request.url !== "/" ||
        typeof requestNonce !== "string" ||
        !noncesMatch(requestNonce, this.nonce) ||
        request.headers["content-type"] !== "application/json" ||
        Number.parseInt(request.headers["content-length"] ?? "", 10) > MAX_REQUEST_LENGTH
      ) {
        response.statusCode = 400;
        response.end();
        return;
      }

      const body = await this.readBody(request);
      const parsedBody: unknown = JSON.parse(body);
      if (!isReferencePromptRequest(parsedBody)) {
        response.statusCode = 400;
        response.end();
        return;
      }

      const prompt = parsedBody.prompt.replace(/\r\n|\r|\n/g, " ");
      const secret = await this.prompt({
        password: isPasswordPrompt(parsedBody.prompt),
        ignoreFocusOut: true,
        prompt
      });
      response.statusCode = 200;
      response.end(secret ?? "");
    } catch {
      if (!response.headersSent) response.statusCode = 400;
      response.end();
    }
  }

  private readBody(request: http.IncomingMessage): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => {
        body += chunk;
        if (body.length > MAX_REQUEST_LENGTH) {
          request.destroy();
          reject(new Error("Askpass request is too large."));
        }
      });
      request.on("end", () => resolve(body));
      request.on("error", () => reject(new Error("Askpass request could not be read.")));
    });
  }
}
