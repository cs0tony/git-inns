import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import * as http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

vi.mock("vscode", () => ({
  window: {
    showInputBox: vi.fn()
  }
}));

import { AskpassManager } from "../../src/askpass/manager";

const execFileAsync = promisify(execFile);

function endpointOf(manager: AskpassManager): string {
  return (manager as unknown as { endpoint: string }).endpoint;
}

function nonceOf(manager: AskpassManager): string {
  return (manager as unknown as { nonce: string }).nonce;
}

function askpassPathOf(manager: AskpassManager): string {
  return (manager as unknown as { askpassPath: string }).askpassPath;
}

function runtimeDirectoryOf(manager: AskpassManager): string {
  return (manager as unknown as { runtimeDirectory: string }).runtimeDirectory;
}

function requestEndpoint(
  manager: AskpassManager,
  body: unknown,
  headers: Record<string, string | number> = {}
): Promise<{ statusCode: number | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    const serializedBody = JSON.stringify(body);
    const httpRequest = http.request(
      {
        socketPath: endpointOf(manager),
        path: "/",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(serializedBody),
          "x-git-keizu-askpass-nonce": nonceOf(manager),
          ...headers
        }
      },
      (response) => {
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          resolve({ statusCode: response.statusCode, body: responseBody });
        });
      }
    );
    httpRequest.on("error", reject);
    httpRequest.end(serializedBody);
  });
}

describe("AskpassManager", () => {
  const showInputBoxMock = vi.mocked(vscode.window.showInputBox);
  let manager: AskpassManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AskpassManager();
  });

  afterEach(async () => {
    await manager.stop();
  });

  it("prompts through a masked, focus-tolerant input box and returns the secret", async () => {
    await manager.start();
    showInputBoxMock.mockImplementationOnce((options) => {
      expect(options).toEqual({
        password: true,
        ignoreFocusOut: true,
        prompt: "Password for 'https://example.com':"
      });
      return Promise.resolve("secret-value");
    });

    const runtimeDirectory = runtimeDirectoryOf(manager);
    const entrypointMode = (await stat(askpassPathOf(manager))).mode & 0o777;
    const { stdout } = await execFileAsync(
      process.execPath,
      [askpassPathOf(manager), "Password for 'https://example.com':"],
      { env: process.env }
    );

    expect(stdout).toBe("secret-value");
    expect(showInputBoxMock).toHaveBeenCalledTimes(1);
    expect(runtimeDirectory).toContain(join(tmpdir(), "git-keizu-askpass-"));
    expect(entrypointMode === 0o700 || process.platform === "win32").toBe(true);
    expect(manager.isReady()).toBe(true);
    expect(manager.getEnvironment()).toMatchObject({
      GIT_ASKPASS: askpassPathOf(manager),
      GIT_TERMINAL_PROMPT: "0",
      SSH_ASKPASS: askpassPathOf(manager),
      SSH_ASKPASS_REQUIRE: "force"
    });
  });

  it("does not mask username prompts", async () => {
    await manager.start();
    showInputBoxMock.mockImplementationOnce((options) => {
      expect(options).toMatchObject({ password: false, ignoreFocusOut: true, prompt: "Username" });
      return Promise.resolve("person@example.com");
    });

    const { stdout } = await execFileAsync(process.execPath, [askpassPathOf(manager), "Username"], {
      env: process.env
    });

    expect(stdout).toBe("person@example.com");
  });

  it("rejects malformed JSON without invoking VS Code", async () => {
    await manager.start();
    const result = await requestEndpoint(manager, { prompt: "Password", extra: true });

    expect(result.statusCode).toBe(400);
    expect(result.body).toBe("");
    expect(showInputBoxMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid nonce without invoking VS Code", async () => {
    await manager.start();
    const result = await requestEndpoint(
      manager,
      { prompt: "Password" },
      {
        "x-git-keizu-askpass-nonce": "wrong"
      }
    );

    expect(result.statusCode).toBe(400);
    expect(result.body).toBe("");
    expect(showInputBoxMock).not.toHaveBeenCalled();
  });

  it("returns empty when the user cancels a password prompt", async () => {
    await manager.start();
    showInputBoxMock.mockResolvedValueOnce(undefined);

    const { stdout } = await execFileAsync(process.execPath, [askpassPathOf(manager), "Password"], {
      env: process.env
    });

    expect(stdout).toBe("");
  });

  it("removes the runtime directory and endpoint on disposal", async () => {
    await manager.start();
    const runtimeDirectory = runtimeDirectoryOf(manager);

    await manager.stop();

    expect(manager.isReady()).toBe(false);
    expect(existsSync(runtimeDirectory)).toBe(false);
    expect(showInputBoxMock).not.toHaveBeenCalled();
  });
});
