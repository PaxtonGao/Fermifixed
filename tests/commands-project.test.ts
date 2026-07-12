import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, mock } from "bun:test";

import { buildDefaultRegistry, type CommandContext } from "../src/commands.js";
import { SessionStore } from "../src/persistence.js";

describe("/project command", () => {
  it("opens an existing Project after saving the current Session", async () => {
    const homeDir = mkdtempSync(join(tmpdir(), "fermi-project-home-"));
    const currentRoot = mkdtempSync(join(tmpdir(), "fermi-project-current-"));
    const targetRoot = mkdtempSync(join(tmpdir(), "fermi-project-target-"));

    try {
      const registry = buildDefaultRegistry();
      const command = registry.lookup("/project");
      expect(command).toBeTruthy();

      const targetStore = new SessionStore({ baseDir: homeDir, projectPath: targetRoot });
      mkdirSync(join(targetStore.projectDir, ".fermi"), { recursive: true });
      writeFileSync(
        join(targetStore.projectDir, ".fermi", "settings.json"),
        JSON.stringify({ enabled_skills: [] }),
      );

      const autoSave = mock();
      const restartRuntimeForProject = mock(async () => {});
      const context: CommandContext = {
        session: {
          hasRunningChildAgents: () => false,
          getBackgroundShellSnapshots: () => [],
        },
        store: new SessionStore({ baseDir: homeDir, projectPath: currentRoot }),
        fermiHomeDir: homeDir,
        showMessage: mock(),
        autoSave,
        resetUiState: mock(),
        commandRegistry: registry,
        isProcessing: () => false,
        promptCommandPicker: mock(async (options: Array<{ label: string }>) => {
          expect(options.some((option) => option.label === `${currentRoot} (current)`)).toBe(true);
          return { value: `recent:${targetRoot}` };
        }),
        restartRuntimeForProject,
      };

      await command!.handler(context, "");

      expect(autoSave).toHaveBeenCalledTimes(1);
      expect(restartRuntimeForProject).toHaveBeenCalledWith(targetRoot);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
      rmSync(currentRoot, { recursive: true, force: true });
      rmSync(targetRoot, { recursive: true, force: true });
    }
  });

  it("creates the first Skill Profile before opening an existing Project", async () => {
    const homeDir = mkdtempSync(join(tmpdir(), "fermi-project-home-"));
    const currentRoot = mkdtempSync(join(tmpdir(), "fermi-project-current-"));
    const targetRoot = mkdtempSync(join(tmpdir(), "fermi-project-target-"));

    try {
      const registry = buildDefaultRegistry();
      const command = registry.lookup("/project")!;
      const targetStore = new SessionStore({ baseDir: homeDir, projectPath: targetRoot });
      const promptCheckboxPicker = mock(async (options: Array<{ value: string }>) => {
        expect(options.some((option) => option.value === "current-only")).toBe(false);
        return ["review"];
      });
      const restartRuntimeForProject = mock(async () => {});
      const context: CommandContext = {
        session: {
          getAllSkillNames: () => [
            { name: "review", description: "Review changes", enabled: true },
            { name: "research", description: "Research a topic", enabled: true },
            { name: "current-only", description: "Current Project Skill", enabled: true },
          ],
          hasRunningChildAgents: () => false,
          getBackgroundShellSnapshots: () => [],
        },
        store: new SessionStore({ baseDir: homeDir, projectPath: currentRoot }),
        fermiHomeDir: homeDir,
        showMessage: mock(),
        autoSave: mock(),
        resetUiState: mock(),
        commandRegistry: registry,
        isProcessing: () => false,
        promptCommandPicker: mock(async () => ({ value: "open", note: targetRoot })),
        promptCheckboxPicker,
        restartRuntimeForProject,
      };

      await command.handler(context, "");

      const profilePath = join(targetStore.projectDir, ".fermi", "settings.json");
      expect(promptCheckboxPicker).toHaveBeenCalledTimes(1);
      expect(JSON.parse(readFileSync(profilePath, "utf-8")).enabled_skills).toEqual(["review"]);
      expect(restartRuntimeForProject).toHaveBeenCalledWith(targetRoot);

      rmSync(profilePath);
      context.promptCheckboxPicker = mock(async () => undefined);
      restartRuntimeForProject.mockClear();
      await command.handler(context, "");
      expect(existsSync(profilePath)).toBe(false);
      expect(restartRuntimeForProject).not.toHaveBeenCalled();
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
      rmSync(currentRoot, { recursive: true, force: true });
      rmSync(targetRoot, { recursive: true, force: true });
    }
  });

  it("creates an empty Project and its Skill Profile only after confirmation", async () => {
    const homeDir = mkdtempSync(join(tmpdir(), "fermi-project-home-"));
    const currentRoot = mkdtempSync(join(tmpdir(), "fermi-project-current-"));
    const parent = mkdtempSync(join(tmpdir(), "fermi-project-parent-"));
    const targetRoot = join(parent, "new-project");

    try {
      const registry = buildDefaultRegistry();
      const command = registry.lookup("/project")!;
      const restartRuntimeForProject = mock(async () => {});
      const context: CommandContext = {
        session: {
          getAllSkillNames: () => [
            { name: "review", description: "Review changes", enabled: true },
          ],
          hasRunningChildAgents: () => false,
          getBackgroundShellSnapshots: () => [],
        },
        store: new SessionStore({ baseDir: homeDir, projectPath: currentRoot }),
        fermiHomeDir: homeDir,
        showMessage: mock(),
        autoSave: mock(),
        resetUiState: mock(),
        commandRegistry: registry,
        isProcessing: () => false,
        promptCommandPicker: mock(async () => ({ value: "create", note: targetRoot })),
        promptCheckboxPicker: mock(async () => ["review"]),
        restartRuntimeForProject,
      };

      await command.handler(context, "");

      expect(existsSync(targetRoot)).toBe(true);
      expect(readdirSync(targetRoot)).toEqual([]);
      const targetStore = new SessionStore({ baseDir: homeDir, projectPath: targetRoot });
      const profile = JSON.parse(readFileSync(join(targetStore.projectDir, ".fermi", "settings.json"), "utf-8"));
      expect(profile.enabled_skills).toEqual(["review"]);
      expect(restartRuntimeForProject).toHaveBeenCalledWith(targetRoot);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
      rmSync(currentRoot, { recursive: true, force: true });
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it("does not switch Projects while the main Agent is running", async () => {
    const homeDir = mkdtempSync(join(tmpdir(), "fermi-project-home-"));
    const currentRoot = mkdtempSync(join(tmpdir(), "fermi-project-current-"));
    const targetRoot = mkdtempSync(join(tmpdir(), "fermi-project-target-"));
    try {
      const targetStore = new SessionStore({ baseDir: homeDir, projectPath: targetRoot });
      mkdirSync(join(targetStore.projectDir, ".fermi"), { recursive: true });
      writeFileSync(join(targetStore.projectDir, ".fermi", "settings.json"), JSON.stringify({ enabled_skills: [] }));
      const registry = buildDefaultRegistry();
      const restartRuntimeForProject = mock(async () => {});
      const showMessage = mock();
      const context: CommandContext = {
        session: {},
        store: new SessionStore({ baseDir: homeDir, projectPath: currentRoot }),
        showMessage,
        autoSave: mock(),
        resetUiState: mock(),
        commandRegistry: registry,
        isProcessing: () => true,
        promptCommandPicker: mock(async () => ({ value: `recent:${targetRoot}` })),
        restartRuntimeForProject,
      };

      await registry.lookup("/project")!.handler(context, "");

      expect(restartRuntimeForProject).not.toHaveBeenCalled();
      expect(showMessage).toHaveBeenCalledWith(expect.stringContaining("current Agent"));
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
      rmSync(currentRoot, { recursive: true, force: true });
      rmSync(targetRoot, { recursive: true, force: true });
    }
  });
});
