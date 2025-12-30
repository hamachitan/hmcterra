//? https://github.com/sindresorhus/github-username/blob/main/index.js  MIT

import { ProbotOctokit } from "probot";

async function searchCommits(octokit: ProbotOctokit, email: string) {
  const { data } = await octokit.search.commits({
    q: `author-email:${email}`,
    sort: 'author-date',
    // eslint-disable-next-line camelcase
    per_page: 1,
  });

  let i = data.items.length;
  while (!data.items[--i]?.author?.login && i >= 0);
  if (i < 0) throw new Error(`Couldn't find username for \`${email}\``);
  return data.items[i]?.author?.login as string;
}

export async function getGithubUsernameFromEmail(octokit: ProbotOctokit, email: string): Promise<string | null> {
  try {
    const { data } = await octokit.search.users({
      q: `${email} in:email`
    });

    let i = data.items.length;
    while (!data.items[--i]?.login && i >= 0);

    if (i < 0) return await searchCommits(octokit, email);

    return data.items[i]?.login as string;
  } catch (error) {
    throw new Error(`Error searching GitHub user for email ${email}: ${error}`);
  }
}
