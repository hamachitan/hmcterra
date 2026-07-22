import { CICheckResult, CILintFunction, CILintParams } from "../ci_linting.ts";

const PREFIX = "    Empty %files file";

export default {
  name: "empty_files",
  check: (
    { logs }: CILintParams,
  ): CICheckResult => {
    const filepaths = logs.filter((l) => l.startsWith(PREFIX)).map((l) =>
      l.substring(PREFIX.length)
    );

    if (filepaths.length === 0) return { comments: [] };

    return {
      comments: [
        "### Empty `%files` file\n```\n" + filepaths.join("\n") + "\n```",
      ],
    };
  },
} satisfies CILintFunction;
