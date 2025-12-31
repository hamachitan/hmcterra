import { runRpmspec } from "../utils.js";

export async function checkPackagerOnContent(specContent: string, filename: string): Promise<string[]> {
  try {
    const packager = await runRpmspec(specContent, '%{packager}');
    if (packager === '(none)') {
      return [`The \`Packager: name <mail@example.com>\` preamble is missing in \`${filename}\` and should be added.`];
    }
  } catch (error) {
    throw new Error(`error checking packager for ${filename}: ${error}`);
  }
  return [];
}
