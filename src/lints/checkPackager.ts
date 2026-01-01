import { runRpmspec } from "../utils.js";
import { CheckResult } from "../linting.js";

export async function checkPackager(specContent: string, filename: string): Promise<CheckResult> {
  try {
    const packager = await runRpmspec(specContent, '%{packager}');
    if (packager === '(none)') {
      return {
        messages: [`The \`Packager: name <mail@example.com>\` preamble is missing in \`${filename}\` and should be added.`],
        reviewComments: []
      };
    }
  } catch (error) {
    throw new Error(`error checking packager for ${filename}: ${error}`);
  }
  return { messages: [], reviewComments: [] };
}
