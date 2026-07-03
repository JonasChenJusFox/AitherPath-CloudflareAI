import { existsSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const devVarsPath = ".dev.vars";
const tempPath = join(tmpdir(), "workinghelper.dev.vars.deploy");
let movedDevVars = false;

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32"
  });

  if (result.status !== 0) {
    process.exitCode = result.status || 1;
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}

try {
  if (existsSync(devVarsPath)) {
    renameSync(devVarsPath, tempPath);
    movedDevVars = true;
  }

  run("vite", ["build"]);
  run("wrangler", ["deploy"]);
} finally {
  if (movedDevVars && existsSync(tempPath)) {
    renameSync(tempPath, devVarsPath);
  }
}
