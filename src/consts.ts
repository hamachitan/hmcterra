export const mdFullPkgNameRegex =
  /^(?=(### Full Raw Package Name.*\n\n))\1(\S+)-([^-\s]+)-([^-\s]+)/m;
export const mdRelverRegex = /^### Release Version\n\n([\d\w]+)$/m;
export const HAMACHITAN_USERNAME = "hamachitan";
export const MADOGUCHI_BASE_URL = "https://madoguchi.fyralabs.com";
export const UNTYPED_ISSUE_CLOSE_MESSAGE =
  "This issue has been automatically locked due to spam protection.\n" +
  "Recreating this issue from the provided issue templates may help.\n" +
  "Maintainers will reopen this issue if this is deemed to be a mistake.";
