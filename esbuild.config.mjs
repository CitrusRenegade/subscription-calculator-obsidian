import esbuild from "esbuild";
import { spawn } from "child_process";
import { readFileSync, watchFile } from "fs";
import { builtinModules } from "module";
import process from "process";

const prod = process.argv[2] === "production";
const watchReload = process.argv.includes("--watch-reload");
const reloadOnly = process.argv.includes("--reload-only");
const pluginId = JSON.parse(readFileSync("manifest.json", "utf8")).id;
const obsidianCliCandidates = process.env.OBSIDIAN_CLI
  ? [process.env.OBSIDIAN_CLI]
  : process.platform === "win32"
    ? ["Obsidian.com", "obsidian"]
    : ["obsidian"];
const pluginAssets = ["styles.css", "manifest.json"];
let reloadInProgress = false;
let reloadPending = false;
let reloadTimer;
const builtins = Array.from(
  new Set(
    builtinModules.flatMap((name) => {
      const bareName = name.startsWith("node:") ? name.slice(5) : name;
      return [bareName, `node:${bareName}`];
    })
  )
);

function spawnObsidianCli(command, args) {
  return new Promise((resolve) => {
    console.log(`[reload] ${command} ${args.join(" ")}`);

    const child = spawn(command, args, {
      stdio: "inherit",
    });

    child.on("error", (error) => {
      resolve({ code: 1, error });
    });

    child.on("close", (code) => {
      resolve({ code: code ?? 1 });
    });
  });
}

async function runObsidianCli(args) {
  let lastError;

  for (const command of obsidianCliCandidates) {
    const result = await spawnObsidianCli(command, args);

    if (result.code === 0) {
      return 0;
    }

    if (result.error) {
      lastError = result.error;
      continue;
    }

    console.error(`[reload] ${command} failed with exit code ${result.code}`);
    return result.code;
  }

  console.error(`Failed to reload Obsidian plugin: ${lastError?.message ?? "CLI not found"}`);
  return 1;
}

function reloadPlugin() {
  return new Promise((resolve) => {
    if (reloadInProgress) {
      reloadPending = true;
      resolve(0);
      return;
    }

    const args = [];

    if (process.env.OBSIDIAN_DEV_VAULT) {
      args.push(`vault=${process.env.OBSIDIAN_DEV_VAULT}`);
    }

    args.push("plugin:reload", `id=${pluginId}`);
    reloadInProgress = true;

    runObsidianCli(args)
      .then((exitCode) => {
        reloadInProgress = false;

        if (exitCode === 0) {
          console.log("[reload] done");
        } else {
          console.error(`[reload] failed with exit code ${exitCode}`);
        }

        if (reloadPending) {
          reloadPending = false;
          void reloadPlugin();
        }

        resolve(exitCode);
      })
      .catch((error) => {
        reloadInProgress = false;
        console.error(`Failed to reload Obsidian plugin: ${error.message}`);
        resolve(1);
      });
  });
}

function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(reloadPlugin, 150);
}

function watchPluginAsset(path) {
  watchFile(path, { interval: 250 }, (current, previous) => {
    if (current.mtimeMs !== previous.mtimeMs) {
      console.log(`[reload] ${path} changed`);
      scheduleReload();
    }
  });
}

const plugins = watchReload
  ? [
      {
        name: "obsidian-plugin-reload",
        setup(build) {
          build.onEnd((result) => {
            if (result.errors.length === 0) {
              scheduleReload();
            }
          });
        },
      },
    ]
  : [];

if (reloadOnly) {
  process.exitCode = await reloadPlugin();
  process.exit();
}

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", ...builtins],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  plugins,
  outfile: "main.js",
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  if (watchReload) {
    for (const asset of pluginAssets) {
      watchPluginAsset(asset);
    }
  }

  await context.watch();
}
