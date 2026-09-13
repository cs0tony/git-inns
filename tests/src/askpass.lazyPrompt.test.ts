import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ASKPASS_MAIN_SCRIPT_NAME } from "../../src/askpass/entrypoints";
import type { AskpassManager } from "../../src/askpass/manager";

const execFileAsync = promisify(execFile);
const showInputBoxMock = vi.fn();

async function runAskpass(
  manager: AskpassManager,
  askpassPath: string,
  runtimeDirectory: string,
  prompt: string
): Promise<{ stdout: string }> {
  const environment = manager.getEnvironment();
  if (process.platform === "win32") {
    const wrapper = await readFile(askpassPath, "utf8");
    expect(wrapper).toContain('"%GIT_KEIZU_NODE%"');
    return execFileAsync(
      process.execPath,
      [join(runtimeDirectory, ASKPASS_MAIN_SCRIPT_NAME), prompt],
      {
        env: environment
      }
    );
  }

  return execFileAsync(askpassPath, [prompt], { env: environment });
}

describe("AskpassManager lazy VS Code loading", () => {
  let manager: AskpassManager;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.doMock("vscode", () => ({
      window: { showInputBox: showInputBoxMock }
    }));
    const { AskpassManager } = await import("../../src/askpass/manager");
    manager = new AskpassManager();
  });

  afterEach(async () => {
    await manager.stop();
    vi.doUnmock("vscode");
    vi.resetModules();
  });

  it("loads without VS Code and dynamically prompts only for a credential request", async () => {
    await manager.start();
    expect(showInputBoxMock).not.toHaveBeenCalled();

    showInputBoxMock.mockResolvedValueOnce("secret-value");
    const askpassPath = (manager as unknown as { askpassPath: string }).askpassPath;
    const runtimeDirectory = (manager as unknown as { runtimeDirectory: string }).runtimeDirectory;
    const environment = manager.getEnvironment();
    expect(environment).toMatchObject({
      ELECTRON_RUN_AS_NODE: "1",
      GIT_KEIZU_NODE: process.execPath
    });

    const { stdout } = await runAskpass(
      manager,
      askpassPath,
      runtimeDirectory,
      "Password for 'https://example.com':"
    );

    expect(stdout).toBe("secret-value");
    expect(showInputBoxMock).toHaveBeenCalledTimes(1);
    expect(showInputBoxMock).toHaveBeenCalledWith({
      password: true,
      ignoreFocusOut: true,
      prompt: "Password for 'https://example.com':"
    });
  });
});
