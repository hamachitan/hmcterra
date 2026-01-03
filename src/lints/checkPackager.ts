import { runRpmspec } from "../utils/rpm.js";
import { CheckResult } from "../linting.js";

import { LintParams } from "../linting.js";

export async function checkPackager({ specContent, file, app }: LintParams): Promise<CheckResult> {
  try {
    const packager = await runRpmspec(specContent, '%{packager}');
    if (packager === '(none)') {
      return {
        messages: [`🍣 The \`Packager: name <mail@example.com>\` preamble is missing in \`${file.filename}\`. This is required in our [policies](https://developer.fyralabs.com/terra/policies#packager-field).`],
        reviewComments: []
      };
    }
  } catch (error) {
    app.log.error(`error checking packager for ${file.filename}: ${error}`);
  }
  return { messages: [], reviewComments: [] };
}
