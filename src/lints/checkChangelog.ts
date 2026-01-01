import { runRpmspec } from "../utils/rpm.js";
import { CheckResult, LintParams } from "../linting.js";

export async function checkChangelog({ app, file, specContent }: LintParams): Promise<CheckResult> {
  const result: CheckResult = { messages: [], reviewComments: [] };

  if (file.status !== 'added') return result;

  if (specContent.endsWith('\n')) specContent = specContent.substring(0, specContent.length - 1);
  const lines = specContent.split('\n');

  const autoIndex = lines.findIndex(line => line.trim() === '%autochangelog');
  if (autoIndex !== -1) {
    try {
      const packager = await runRpmspec(specContent, '%{packager}');
      if (packager === '(none)') return result;

      const versionRelease = await runRpmspec(specContent, '%{version}-%{release}');
      const date = new Date().toDateString();

      const replacement = `* ${date} ${packager} - ${versionRelease}\n- Initial package`;

      result.reviewComments.push({
        path: file.filename,
        position: autoIndex + 1,
        body: `\`%autochangelog\` is not supported in Terra. Consider replacing it with a proper changelog entry:\n\n\`\`\`suggestion\n${replacement}\n\`\`\``,
      });

      app.log.info(`lint %autochangelog: ${file.filename}`);

    } catch (error) {
      app.log.error(`error processing %autochangelog for ${file.filename}: ${error}`);
    }
    return result;
  }

  try {
    const changelogQuery = await runRpmspec(specContent, '%{changelogtime} %{changelogname}', ['-D', 'autochangelog %nil']);
    if (changelogQuery.trim() !== '(none) (none)') return result;
  } catch (error) {
    app.log.error(`error checking changelog existence for ${file.filename}: ${error}`);
    return result;
  }

  try {
    const packager = await runRpmspec(specContent, '%{packager}');
    if (packager === '(none)') return result;

    const versionRelease = await runRpmspec(specContent, '%{version}-%{release}');
    const date = new Date().toDateString();
    let lastLine = lines[lines.length - 1] || '';
    if (lastLine !== '') lastLine += "\n";

    const suggestion = `${lastLine}\n%changelog\n* ${date} ${packager} - ${versionRelease}\n- Initial package`;

    result.reviewComments.push({
      path: file.filename,
      position: lines.length - 1, // last line
      body: `Changelog is missing in new spec file.\n\`\`\`suggestion\n${suggestion}\n\`\`\``,
    });

    app.log.info(`lint %changelog: ${file.filename}`);
  } catch (error) {
    app.log.error(`error processing missing changelog for ${file.filename}: ${error}`);
  }

  return result;
}
