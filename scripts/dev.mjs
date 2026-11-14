import { spawn } from "node:child_process";
const args = process.argv.slice(2);
let host = "127.0.0.1",
  port = "8787";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--host") host = args[++i];
  else if (args[i] === "--port") port = args[++i];
}
const child = spawn(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "dev",
    "--ip",
    host,
    "--port",
    port,
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME || "/tmp/still-config",
      WRANGLER_LOG_PATH:
        process.env.WRANGLER_LOG_PATH || "/tmp/still-wrangler.log",
    },
  },
);
child.on("exit", (code) => process.exit(code ?? 1));
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => child.kill(s));
