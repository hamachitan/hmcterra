import { Buffer } from "node:buffer";
import { CheckResult, LintParams } from "../linting.ts";
import { parseSpec } from "../utils/rpm.ts";

const archesRegex = /arches\s*=\s*\[([^\]]*)\]/;
const quotedRegex = /"([^"]+)"/g;

function parseAndaArches(content: string): string[] | null {
  const match = archesRegex.exec(content);
  if (!match) return null;
  return [...match[1].matchAll(quotedRegex)].map((m) => m[1]);
}

function parseBuildTags(parsedSpec: string) {
  const exclusiveArch = new Set<string>();
  let buildArch: string | undefined;

  for (const line of parsedSpec.split("\n")) {
    const trimmed = line.trim();
    if (/^%package\b/i.test(trimmed)) break;

    const exclusive = /^ExclusiveArch\s*:\s*(.+)$/i.exec(trimmed);
    if (exclusive) {
      for (const arch of exclusive[1].trim().split(/\s+/)) {
        exclusiveArch.add(arch);
      }
    }

    const build = /^BuildArch\s*:\s*(.+)$/i.exec(trimmed);
    if (build) buildArch = build[1].trim().split(/\s+/)[0];
  }

  return { exclusiveArch, buildArch };
}

const formatList = (items: Iterable<string>) =>
  [...items].map((item) => `\`${item}\``).join(", ");

export async function checkArches(
  { context, app, file, specContent }: LintParams,
): Promise<CheckResult> {
  const result: CheckResult = { messages: [], reviewComments: [] };

  const dir = file.filename.includes("/")
    ? file.filename.slice(0, file.filename.lastIndexOf("/"))
    : "";
  const andaPath = dir ? `${dir}/anda.hcl` : "anda.hcl";

  let andaContent: string;
  try {
    const { data } = await context.octokit.repos.getContent(
      context.repo({
        path: andaPath,
        ref: context.payload.pull_request.head.sha,
      }),
    );
    if (!("content" in data)) return result;
    andaContent = Buffer.from(data.content, "base64").toString("utf8");
  } catch (error) {
    if ((error as { status?: number }).status !== 404) {
      app.log.error(`error fetching ${andaPath}: ${error}`);
    }
    return result;
  }

  const arches = parseAndaArches(andaContent);
  if (!arches || arches.length === 0) return result;

  let parsedSpec: string;
  try {
    parsedSpec = await parseSpec(specContent);
  } catch (error) {
    app.log.error(`error parsing spec for ${file.filename}: ${error}`);
    return result;
  }

  const { exclusiveArch, buildArch } = parseBuildTags(parsedSpec);

  if (
    exclusiveArch.size > 0 &&
    ![...exclusiveArch].some((arch) => arch.includes("%"))
  ) {
    const disallowed = arches.filter((arch) => !exclusiveArch.has(arch));
    if (disallowed.length > 0) {
      result.messages.push(
        `🍣 \`arches = [...]\` in \`${andaPath}\` includes ${
          formatList(disallowed)
        }, but \`${file.filename}\` restricts builds with \`ExclusiveArch\` to ${
          formatList(exclusiveArch)
        }.`,
      );
    }
  }

  if (buildArch === "noarch" && arches.length > 1) {
    result.messages.push(
      `🍣 \`${file.filename}\` uses \`BuildArch: noarch\`, so \`arches\` in \`${andaPath}\` should contain a single architecture (currently ${
        formatList(arches)
      }).`,
    );
  }

  return result;
}
