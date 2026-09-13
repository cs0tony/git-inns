import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AskpassManager } from "../../src/askpass/manager";

const execFileAsync = promisify(execFile);
const showInputBoxMock = vi.fn();

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
    const { stdout } = await execFileAsync(
      process.execPath,
      [askpassPath, "Password for 'https://example.com':"],
      { env: process.env }
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
