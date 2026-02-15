import path from "node:path";
import type { PlanFile, WorkspaceContext } from "../types.js";
import { readYamlFile, writeYamlFile } from "../infra/fs.js";

export async function writePlanFile(
  context: WorkspaceContext,
  planFile: PlanFile,
  outPath?: string,
): Promise<string> {
  const target =
    outPath ??
    path.join(
      context.paths.plansDir,
      `plan-${new Date().toISOString().replace(/[.:]/g, "-")}.yaml`,
    );
  await writeYamlFile(target, planFile);
  return target;
}

export async function readPlanFile(filePath: string): Promise<PlanFile> {
  const plan = await readYamlFile<PlanFile>(filePath);
  if (!plan) {
    throw new Error(`Plan file not found: ${filePath}`);
  }
  return plan;
}
