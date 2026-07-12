import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, mock } from "bun:test";

import { buildDefaultRegistry, type CommandContext } from "../src/commands.js";
import { SessionStore } from "../src/persistence.js";
import { Session } from "../src/session.js";

function createSkill(root: string, name: string): void {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name} skill\n---\n\nUse ${name}.\n`,
  );
}

function buildSession(skillRoot: string): Session {
  const modelConfig = {
    name: "test-model",
    provider: "openai",
    model: "gpt-5.4",
    apiKey: "sk-test",
    maxTokens: 1024,
    contextLength: 128000,
    supportsMultimodal: false,
  };
  const primaryAgent = {
    name: "Primary",
    systemPrompt: "",
    tools: [],
    modelConfig: { ...modelConfig },
    _provider: { budgetCalcMode: "full_context" },
    replaceModelConfig(next: unknown) { this.modelConfig = next as typeof modelConfig; },
  } as any;
  const config = {
    pathOverrides: {},
    subAgentModelName: undefined,
    agentModels: {},
    modelTiers: {},
    mcpServerConfigs: [],
    getModel: () => ({ ...modelConfig }),
    listModelEntries: () => [],
    upsertModelRaw: () => {},
    get modelNames() { return ["test-model"]; },
  } as any;
  return new Session({
    primaryAgent,
    config,
    agentTemplates: {},
    skillRoots: [skillRoot],
  });
}

describe("/proskills command", () => {
  it("saves an exact enabled Skill Profile for the current Project", async () => {
    const homeDir = mkdtempSync(join(tmpdir(), "fermi-project-skills-home-"));
    const projectRoot = mkdtempSync(join(tmpdir(), "fermi-project-skills-root-"));

    try {
      const registry = buildDefaultRegistry();
      const command = registry.lookup("/proskills");
      expect(command).toBeTruthy();

      const enabled = new Set(["review", "research"]);
      const reloadSkills = mock(() => ({ added: [], removed: ["research"], total: 1 }));
      const session = {
        skills: new Map(),
        getAllSkillNames: () => [
          { name: "review", description: "Review changes", enabled: enabled.has("review") },
          { name: "research", description: "Research a topic", enabled: enabled.has("research") },
        ],
        setSkillEnabled: (name: string, value: boolean) => {
          if (value) enabled.add(name);
          else enabled.delete(name);
        },
        setProjectSkillProfile: (names: string[]) => {
          enabled.clear();
          for (const name of names) enabled.add(name);
        },
        reloadSkills,
        notifySkillAvailabilityChanged: mock(),
      };
      const store = new SessionStore({ baseDir: homeDir, projectPath: projectRoot });
      const context: CommandContext = {
        session,
        store,
        fermiHomeDir: homeDir,
        showMessage: mock(),
        autoSave: mock(),
        resetUiState: mock(),
        commandRegistry: registry,
      };

      await command!.handler(context, "review");

      const profilePath = join(store.projectDir, ".fermi", "settings.json");
      const profile = JSON.parse(readFileSync(profilePath, "utf-8"));
      expect(profile.enabled_skills).toEqual(["review"]);
      expect(existsSync(join(homeDir, "settings.json"))).toBe(false);
      expect(reloadSkills).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("keeps Skills outside the Project allowlist disabled after reload", () => {
    const skillRoot = mkdtempSync(join(tmpdir(), "fermi-project-skill-catalog-"));
    try {
      createSkill(skillRoot, "review");
      createSkill(skillRoot, "research");
      const session = buildSession(skillRoot);

      session.applySettings({ enabled_skills: ["review"] }, {});
      expect(session.getAllSkillNames()).toEqual([
        { name: "research", description: "research skill", enabled: false },
        { name: "review", description: "review skill", enabled: true },
      ]);

      createSkill(skillRoot, "new-skill");
      session.reloadSkills();
      expect(session.getAllSkillNames().find((skill) => skill.name === "new-skill")?.enabled).toBe(false);
    } finally {
      rmSync(skillRoot, { recursive: true, force: true });
    }
  });

  it("keeps global disabled Skills behavior when no Project Profile exists", () => {
    const skillRoot = mkdtempSync(join(tmpdir(), "fermi-global-skill-catalog-"));
    try {
      createSkill(skillRoot, "review");
      createSkill(skillRoot, "research");
      const session = buildSession(skillRoot);

      session.applySettings({ disabled_skills: ["research"] }, {});

      expect(session.getAllSkillNames()).toEqual([
        { name: "research", description: "research skill", enabled: false },
        { name: "review", description: "review skill", enabled: true },
      ]);
    } finally {
      rmSync(skillRoot, { recursive: true, force: true });
    }
  });

  it("keeps /skills persistence global", async () => {
    const homeDir = mkdtempSync(join(tmpdir(), "fermi-global-skills-home-"));
    try {
      const registry = buildDefaultRegistry();
      const command = registry.lookup("/skills")!;
      const enabled = new Set(["review", "research"]);
      const session = {
        skills: new Map(),
        getAllSkillNames: () => [
          { name: "review", description: "Review", enabled: enabled.has("review") },
          { name: "research", description: "Research", enabled: enabled.has("research") },
        ],
        setSkillEnabled: (name: string, value: boolean) => {
          if (value) enabled.add(name);
          else enabled.delete(name);
        },
        reloadSkills: () => ({ added: [], removed: ["research"], total: 1 }),
      };
      const context: CommandContext = {
        session,
        fermiHomeDir: homeDir,
        showMessage: mock(),
        autoSave: mock(),
        resetUiState: mock(),
        commandRegistry: registry,
      };

      await command.handler(context, "review");

      expect(JSON.parse(readFileSync(join(homeDir, "settings.json"), "utf-8")).disabled_skills).toEqual(["research"]);
      expect(existsSync(join(homeDir, "projects"))).toBe(false);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
