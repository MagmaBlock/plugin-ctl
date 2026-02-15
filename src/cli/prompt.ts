import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export async function confirmAction(message: string, force = false): Promise<boolean> {
  if (force) {
    return true;
  }
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(`${message} [y/N]: `);
    return ["y", "yes"].includes(answer.trim().toLowerCase());
  } finally {
    rl.close();
  }
}
