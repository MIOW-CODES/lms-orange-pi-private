import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

type RunOptions = { env: NodeJS.ProcessEnv; captureOutput?: boolean };

function run(command: string, args: string[], options: RunOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: options.env,
      stdio: options.captureOutput ? ["ignore", "pipe", "inherit"] : "inherit",
      windowsHide: true,
    });
    let stdout = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.once("error", (error) => {
      reject(new Error(`Could not start ${command}: ${error.message}`));
    });
    child.once("close", (code, signal) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${command} ${args[0] ?? ""} failed (${code ?? signal ?? "unknown"})`));
    });
  });
}

async function main(): Promise<void> {
  const projectName = `miow-pgtest-${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const bootstrapPassword = randomBytes(32).toString("hex");
  const migratorPassword = randomBytes(32).toString("hex");
  const appPassword = randomBytes(32).toString("hex");
  const composeArgs = [
    "compose",
    "--file",
    "docker-compose.pgtest.yml",
    "--project-name",
    projectName,
  ];
  const composeEnv: NodeJS.ProcessEnv = {
    ...process.env,
    MIOW_PGTEST_BOOTSTRAP_PASSWORD: bootstrapPassword,
    MIOW_PGTEST_MIGRATOR_PASSWORD: migratorPassword,
    MIOW_PGTEST_APP_PASSWORD: appPassword,
  };
  let dockerAvailable = false;
  let failure: unknown;

  try {
    await run("docker", ["info", "--format", "{{.ServerVersion}}"], {
      env: composeEnv,
      captureOutput: true,
    });
    dockerAvailable = true;
    await run(
      "docker",
      [...composeArgs, "up", "--detach", "--wait", "--wait-timeout", "90", "postgres"],
      { env: composeEnv },
    );

    const publishedPort = await run("docker", [...composeArgs, "port", "postgres", "5432"], {
      env: composeEnv,
      captureOutput: true,
    });
    const port = /127\.0\.0\.1:(\d+)\s*$/.exec(publishedPort)?.[1];
    if (!port) throw new Error("Docker Compose did not report the disposable PostgreSQL port");

    const host = `127.0.0.1:${port}`;
    const testEnv: NodeJS.ProcessEnv = {
      ...composeEnv,
      DATABASE_URL: `postgres://miow_app:${appPassword}@${host}/miow`,
      MIGRATOR_DATABASE_URL: `postgres://miow_migrator:${migratorPassword}@${host}/miow`,
      APP_DATABASE_ROLE: "miow_app",
      MIOW_PG_INTEGRATION_RUN: "1",
    };

    console.log(
      "[test:integration] applying native migrations concurrently to disposable PostgreSQL 16",
    );
    await Promise.all([
      run(process.execPath, ["run", "db:migrate"], { env: testEnv }),
      run(process.execPath, ["run", "db:migrate"], { env: testEnv }),
    ]);
    await run(process.execPath, ["run", "db:migrate"], { env: testEnv });
    await run(process.execPath, ["test", "tests/integration/"], { env: testEnv });
  } catch (error) {
    failure = error;
  } finally {
    if (dockerAvailable) {
      try {
        await run("docker", [...composeArgs, "down", "--volumes", "--remove-orphans"], {
          env: composeEnv,
        });
      } catch (error) {
        if (!failure) failure = error;
        else console.error("[test:integration] disposable PostgreSQL cleanup also failed");
      }
    }
  }

  if (failure) throw failure;
  console.log("[test:integration] native PostgreSQL checks passed; disposable data was removed");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Native PostgreSQL integration failed");
  process.exitCode = 1;
});
