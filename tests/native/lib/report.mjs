// Readable per-scenario markdown report plus the overall run verdict.
// Overall verdicts: SUCCESS (all scenarios Passed, cleanup complete),
// FAILURE (>=1 Failed), INCOMPLETE (Blocked scenarios or incomplete cleanup, no Failed),
// ERROR (harness could not run scenarios at all).

export function formatRunHeader(run) {
  const lines = [
    `# Native smoke report — ${run.id}`,
    "",
    `- **Verdict:** ${run.verdict}`,
    `- **Target:** vault \`${run.config.vaultName}\` at \`${run.config.vaultPath}\`, plugin \`${run.config.pluginId}\``,
    `- **Obsidian:** ${run.versions.app ?? "unknown"} · Plugin manifest: ${run.versions.plugin ?? "unknown"}`,
    `- **Candidate revision:** ${run.revision.revision ?? "unknown"}${run.revision.dirtyFiles ? ` (${run.revision.dirtyFiles} uncommitted files)` : " (clean tree)"}`,
    `- **Artifact:** ${run.artifact.matchesRepoBuild ? "vault install matches repo build" : "vault install DIFFERS from repo build"} · main.js sha256 \`${run.artifact.installed["main.js"] ?? "missing"}\``,
    `- **Window:** ${run.window.line}`,
    `- **Renderer readiness:** ${run.readiness.line}`,
    "",
  ];
  return lines.join("\n");
}

export function formatScenario(section) {
  const lines = [
    `## ${section.id} — ${section.title}: **${section.status}**`,
    "",
  ];
  if (section.preconditions) lines.push(`Preconditions: ${section.preconditions}`, "");
  if (section.reason) lines.push(`> ${section.status}: ${section.reason}`, "");
  for (const step of section.steps) {
    lines.push(`- ${step.ok ? "ok" : "FAIL"} — ${step.name}${step.detail ? `: ${step.detail}` : ""}`);
  }
  if (section.evidence.length) {
    lines.push("", "Evidence:");
    for (const item of section.evidence) lines.push(`- ${item}`);
  }
  if (section.cleanup) {
    lines.push("", `Cleanup: ${section.cleanup.complete ? "complete" : `INCOMPLETE — ${section.cleanup.problems.join("; ")}`}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function formatReport(run, sections) {
  const parts = [formatRunHeader(run)];
  const summary = sections.map((s) => `| ${s.id} | ${s.title} | ${s.status} | ${s.reason ?? ""} |`);
  parts.push(["| Scenario | Title | Status | Reason |", "| --- | --- | --- | --- |", ...summary].join("\n"), "");
  for (const section of sections) parts.push(formatScenario(section));
  if (run.cleanup) {
    parts.push(
      `## Suite cleanup`,
      "",
      run.cleanup.complete
        ? "All suite-owned fixtures were removed and temporary changes restored."
        : `INCOMPLETE — ${run.cleanup.problems.join("; ")}`,
      ""
    );
  }
  if (run.notes?.length) parts.push("## Notes", "", ...run.notes.map((note) => `- ${note}`), "");
  return parts.join("\n");
}

export function overallVerdict(sections, cleanup) {
  if (sections.some((s) => s.status === "Failed")) return "FAILURE";
  if (sections.some((s) => s.status === "Blocked") || (cleanup && !cleanup.complete)) return "INCOMPLETE";
  if (sections.length && sections.every((s) => s.status === "Passed")) return "SUCCESS";
  return "INCOMPLETE";
}

export function exitCodeFor(verdict) {
  switch (verdict) {
    case "SUCCESS": return 0;
    case "FAILURE": return 1;
    case "INCOMPLETE": return 2;
    default: return 3;
  }
}
