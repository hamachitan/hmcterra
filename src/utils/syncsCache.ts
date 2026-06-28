import { Context, Probot } from "probot";

const SYNCS_CACHE_EXPIRE = 12 * 60 * 60 * 1000;
let syncsCache = {
  syncs: [""] as string[],
  timestamp: 0,
  isExpired: () =>
    process.env.VITEST === "true" ||
    Date.now() - syncsCache.timestamp >= SYNCS_CACHE_EXPIRE,
};

export function syncLabelToBranch(label: string): string {
  return label.replace(/^sync-/, "");
}

export async function getSyncLabels(
  context: Context<"pull_request">,
  app: Probot,
): Promise<string[]> {
  let last = syncsCache.isExpired();
  do {
    try {
      let syncs: string[];
      if (syncsCache.isExpired()) {
        const labels = await context.octokit.issues.listLabelsForRepo(
          context.repo(),
        );
        syncs = labels.data.map((lbl) => lbl.name).filter((name: string) =>
          name.startsWith("sync-")
        );
        syncsCache = { ...syncsCache, syncs, timestamp: Date.now() };
      } else {
        syncs = syncsCache.syncs;
      }
      return syncs;
    } catch (err) {
      app.log.error(`fail to get sync labels: ${err}`);
      syncsCache.timestamp = 0;
    }
  } while (!last && (last = syncsCache.isExpired()));
  return [];
}

export async function getSyncBranches(
  context: Context<"pull_request">,
  app: Probot,
): Promise<string[]> {
  const labels = await getSyncLabels(context, app);
  return labels.map(syncLabelToBranch);
}
