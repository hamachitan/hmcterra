import { CICheckResult, CILintFunction, CILintParams } from "../ci_linting.ts";

const PREFIX = "    File not found: ";

export default {
  name: "file_not_found",
  check: (
    { logs }: CILintParams,
  ): CICheckResult => {
    const filepaths = logs.filter((l) => l.startsWith(PREFIX)).map((l) =>
      l.substring(PREFIX.length)
    );

    if (filepaths.length === 0) return { comments: [] };

    return {
      comments: [
        "### Files not found\n```\n" + filepaths.join("\n") + "\n```",
      ],
    };
  },
} satisfies CILintFunction;
