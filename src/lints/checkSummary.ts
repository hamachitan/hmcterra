import { runRpmspec } from "../utils/rpm.ts";
import { CheckResult, LintParams } from "../linting.ts";

export async function checkSummary(
  { app, file, specContent }: LintParams,
): Promise<CheckResult> {
  const result: CheckResult = { messages: [], reviewComments: [] };

  try {
    const output = await runRpmspec(specContent, "[%{name}\t%{summary}\n]");
    const offenders = output.split("\n").flatMap((line) => {
      const [name, summary] = line.split("\t");
      if (!summary?.trimEnd().endsWith(".")) return [];
      return [{ name, summary: summary.trimEnd() }];
    });

    if (offenders.length === 0) return result;

    result.messages.push(
      `🍣 The \`Summary:\` field should not end with a period in \`${file.filename}\`:\n\n` +
        offenders.map(({ name, summary }) => `- \`${name}\`: \`${summary}\``)
          .join("\n"),
    );
  } catch (error) {
    app.log.error(`error checking summary for ${file.filename}: ${error}`);
  }

  return result;
}
