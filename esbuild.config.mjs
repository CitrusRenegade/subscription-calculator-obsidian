import esbuild from "esbuild";
import { builtinModules } from "module";
import process from "process";

const prod = process.argv[2] === "production";
const builtins = Array.from(
  new Set(
    builtinModules.flatMap((name) => {
      const bareName = name.startsWith("node:") ? name.slice(5) : name;
      return [bareName, `node:${bareName}`];
    })
  )
);

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", ...builtins],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}

