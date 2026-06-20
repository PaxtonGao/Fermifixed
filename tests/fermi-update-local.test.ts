import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const script = "scripts/fermi-update-local.sh";

describe("fermi-update-local", () => {
  it("is a valid local rebuild installer script", () => {
    expect(existsSync(script)).toBe(true);
    const check = spawnSync("bash", ["-n", script], { encoding: "utf8" });
    expect(check.status).toBe(0);

    const text = readFileSync(script, "utf8");
    expect(text).toContain("git pull --ff-only");
    expect(text).toContain("bun run build");
    expect(text).toContain('cp "$repo/build/fermi" "$bin"');
  });
});
