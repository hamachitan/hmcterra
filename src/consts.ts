export const mdFullPkgNameRegex =
  /^(?=(### Full Raw Package Name.*\n\n))\1(\S+)-([^-\s]+)-([^-\s]+)/m;
export const mdRelverRegex = /^### Release Version\n\n([\d\w]+)$/m;
export const HAMACHITAN_USERNAME = "hamachitan";
export const MADOGUCHI_BASE_URL = "https://madoguchi.fyralabs.com";
export const UNTYPED_ISSUE_CLOSE_MESSAGE =
  "This issue has been automatically locked due to spam protection.\n" +
  "Recreating this issue from the provided issue templates may help.\n" +
  "Maintainers will reopen this issue if this is deemed to be a mistake.";
export const ISSUE_DETAILS_THANKS =
  "Thanks for your bug report! Terra is maintained by a lot of contributors and volunteers, so it may take a while before you get a response.\n" +
  "We encourage you to also [contribute](https://docs.terrapkg.com/contributing/getting-started/) to Terra!";
