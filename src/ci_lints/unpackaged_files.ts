import { CICheckResult, CILintParams } from "../ci_linting.js";

const markerLine = "    Installed (but unpackaged) file(s) found:";

export async function unpackagedFiles({ logs }: CILintParams): Promise<CICheckResult> {
  for (let i = 0; i < logs.length - 1; i += 1) {
    if (logs[i] !== "" || logs[i + 1] !== markerLine) continue;

    const filepaths: string[] = [];
    for (let j = i + 2; j < logs.length; j += 1) {
      const line = logs[j];
      if (!line.startsWith("   /")) break;
      filepaths.push(line.slice(3));
    }

    if (filepaths.length === 0) return { comments: [] };

    return {
      comments: [
        "### Unpackaged files\n```\n" + filepaths.join("\n") + "\n```",
      ],
    };
  }

  return { comments: [] };
}
