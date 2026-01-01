import { runRpmspec } from "../utils/rpm.js";
import { CheckResult } from "../linting.js";

import { LintParams } from "../linting.js";

export async function checkPackager({ specContent, file }: LintParams): Promise<CheckResult> {
  try {
    const packager = await runRpmspec(specContent, '%{packager}');
    if (packager === '(none)') {
      return {
        messages: [`The \`Packager: name <mail@example.com>\` preamble is missing in \`${file.filename}\` and should be added.`],
        reviewComments: []
      };
    }
  } catch (error) {
    throw new Error(`error checking packager for ${file.filename}: ${error}`);
  }
  return { messages: [], reviewComments: [] };
}
