import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import * as http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ASKPASS_MAIN_SCRIPT_NAME } from "../../src/askpass/entrypoints";
import { AskpassManager, type AskpassPrompt } from "../../src/askpass/manager";

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

function mainAskpassPathOf(manager: AskpassManager): string {
  return join(runtimeDirectoryOf(manager), ASKPASS_MAIN_SCRIPT_NAME);
}

async function runAskpassWrapper(
  manager: AskpassManager,
  args: readonly [prompt: string]
): Promise<{ stdout: string }> {
  const environment = manager.getEnvironment();
  if (process.platform === "win32") {
    // Avoid spawning a batch wrapper directly from Node in cross-platform tests.
    const wrapper = await readFile(askpassPathOf(manager), "utf8");
    expect(wrapper).toContain('"%GIT_KEIZU_NODE%"');
    return execFileAsync(process.execPath, [mainAskpassPathOf(manager), ...args], {
      env: environment
    });
  }

  return execFileAsync(askpassPathOf(manager), [...args], { env: environment });
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
  const promptMock = vi.fn<AskpassPrompt>();
  let manager: AskpassManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AskpassManager(undefined, promptMock);
  });

  afterEach(async () => {
    await manager.stop();
  });

  it("prompts through the injected seam with a masked, focus-tolerant input box", async () => {
    await manager.start();
    promptMock.mockResolvedValueOnce("secret-value");

    const runtimeDirectory = runtimeDirectoryOf(manager);
    const entrypointMode = (await stat(askpassPathOf(manager))).mode & 0o777;
    const wrapper = await readFile(askpassPathOf(manager), "utf8");
    const { stdout } = await runAskpassWrapper(manager, ["Password for 'https://example.com':"]);

    expect(stdout).toBe("secret-value");
    expect(promptMock).toHaveBeenCalledTimes(1);
    expect(promptMock).toHaveBeenCalledWith({
      password: true,
      ignoreFocusOut: true,
      prompt: "Password for 'https://example.com':"
    });
    expect(wrapper).not.toContain(endpointOf(manager));
    expect(wrapper).not.toContain(nonceOf(manager));
    expect(runtimeDirectory).toContain(join(tmpdir(), "git-keizu-askpass-"));
    expect(entrypointMode === 0o700 || process.platform === "win32").toBe(true);
    expect(manager.isReady()).toBe(true);
    expect(manager.getEnvironment()).toMatchObject({
      ELECTRON_RUN_AS_NODE: "1",
      GIT_ASKPASS: askpassPathOf(manager),
      GIT_KEIZU_NODE: process.execPath,
      GIT_TERMINAL_PROMPT: "0",
      SSH_ASKPASS: askpassPathOf(manager),
      SSH_ASKPASS_REQUIRE: "force"
    });
  });

  it("does not mask username prompts", async () => {
    await manager.start();
    promptMock.mockResolvedValueOnce("person@example.com");

    const { stdout } = await runAskpassWrapper(manager, ["Username"]);

    expect(stdout).toBe("person@example.com");
    expect(promptMock).toHaveBeenCalledWith({
      password: false,
      ignoreFocusOut: true,
      prompt: "Username"
    });
  });

  it("rejects malformed JSON without invoking VS Code", async () => {
    await manager.start();
    const result = await requestEndpoint(manager, { prompt: "Password", extra: true });

    expect(result.statusCode).toBe(400);
    expect(result.body).toBe("");
    expect(promptMock).not.toHaveBeenCalled();
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
    expect(promptMock).not.toHaveBeenCalled();
  });

  it("returns empty when the user cancels a password prompt", async () => {
    await manager.start();
    promptMock.mockResolvedValueOnce(undefined);

    const { stdout } = await runAskpassWrapper(manager, ["Password"]);

    expect(stdout).toBe("");
  });

  it("removes the runtime directory and endpoint on disposal", async () => {
    await manager.start();
    const runtimeDirectory = runtimeDirectoryOf(manager);

    await manager.stop();

    expect(manager.isReady()).toBe(false);
    expect(existsSync(runtimeDirectory)).toBe(false);
    expect(promptMock).not.toHaveBeenCalled();
  });
});
