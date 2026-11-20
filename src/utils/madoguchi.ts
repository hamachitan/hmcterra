import { MADOGUCHI_BASE_URL } from "../consts.ts";

export interface PkgInfo {
  name: string;
  repo: string;
  ver: string;
  rel: string;
  arch: string;
  dirs: string;
}

export interface Build {
  id: string;
  epoch: string;
  pname: string;
  pver: string;
  prel: string;
  parch: string;
  repo: string;
  succ: boolean;
  commit: string | null;
}

async function getJson<T>(path: string): Promise<T | null> {
  const res = await fetch(`${MADOGUCHI_BASE_URL}${path}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`madoguchi ${path} failed with ${res.status}`);
  }
  return await res.json() as T;
}

export async function getPkgInfo(
  repo: string,
  name: string,
): Promise<PkgInfo | null> {
  return await getJson<PkgInfo>(
    `/api/${repo}/packages/${encodeURIComponent(name)}`,
  );
}

export async function getBuilds(
  repo: string,
  name: string,
): Promise<Build[]> {
  return await getJson<Build[]>(
    `/api/${repo}/builds/${encodeURIComponent(name)}`,
  ) ?? [];
}

export async function getSpecContent(
  repo: string,
  name: string,
): Promise<string | null> {
  const url = `${MADOGUCHI_BASE_URL}/redirect/${repo}/packages/${
    encodeURIComponent(name)
  }/spec/raw`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return await res.text();
}
