import { existsSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const devVarsPath = ".dev.vars";
const tempPath = join(tmpdir(), "workinghelper.dev.vars.build");
let movedDevVars = false;

try {
  if (existsSync(devVarsPath)) {
    renameSync(devVarsPath, tempPath);
    movedDevVars = true;
  }

  const result = spawnSync("vite", ["build"], {
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  if (result.status !== 0) process.exitCode = result.status || 1;
} finally {
  if (movedDevVars && existsSync(tempPath)) {
    renameSync(tempPath, devVarsPath);
  }
}
