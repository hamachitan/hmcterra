export const gitBranch2SatmBranch = (b: string) => b.startsWith("f") ? b.slice(1) : b;
export const isProdBranch = (branch: string) => /^frawhide|el\d+|f\d+$/.test(branch);
