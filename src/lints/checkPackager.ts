import { runRpmspec } from "../utils/rpm.ts";
import { CheckResult } from "../linting.ts";

import { LintParams } from "../linting.ts";

export async function checkPackager(
  { specContent, file, app }: LintParams,
): Promise<CheckResult> {
  try {
    const packager = await runRpmspec(specContent, "%{packager}");
    if (packager === "(none)") {
      return {
        messages: [
          `🍣 The \`Packager: name <mail@example.com>\` preamble is missing in \`${file.filename}\`. This is required in our [policies](https://docs.terrapkg.com/contributing/policies/#packager-field).`,
        ],
        reviewComments: [],
      };
    }
  } catch (error) {
    app.log.error(`error checking packager for ${file.filename}: ${error}`);
  }
  return { messages: [], reviewComments: [] };
}
