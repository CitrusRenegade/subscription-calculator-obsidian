export function getReadinessProblems({ native, renderer, placement }) {
  const problems = [];
  if (!native.visible || native.minimized) {
    problems.push(`native window not exposed (visible=${native.visible}, minimized=${native.minimized})`);
  }
  if (!renderer.visible || !renderer.rafAlive) {
    problems.push(`renderer not painting (visibility=${renderer.visible}, rafAlive=${renderer.rafAlive})`);
  }
  if (placement?.requested && !placement?.established) {
    problems.push("requested window placement did not complete before the run (--skip-place skips placement)");
  }
  return problems;
}
