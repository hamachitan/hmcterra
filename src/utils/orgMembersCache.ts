import { Context, Probot } from "probot";

const ORG_MEMBERS_CACHE_EXPIRE = 12 * 60 * 60 * 1000;
const orgMembersCache = new Map<string, { members: string[]; timestamp: number }>();

function isExpired(timestamp: number): boolean {
  return process.env.VITEST === 'true' || Date.now() - timestamp >= ORG_MEMBERS_CACHE_EXPIRE;
}

export async function getOrgMembers(context: Context<"issue_comment.created">, app: Probot, org: string = "terrapkg"): Promise<string[]> {
  const cached = orgMembersCache.get(org);
  if (cached && !isExpired(cached.timestamp)) {
    return cached.members;
  }

  try {
    const { data } = await context.octokit.orgs.listMembers({ org });
    const members = data.map(member => member.login);
    orgMembersCache.set(org, { members, timestamp: Date.now() });
    return members;
  } catch (err) {
    app.log.error(`fail to list org members for ${org}: ${err}`);
    orgMembersCache.delete(org);
    return [];
  }
}
