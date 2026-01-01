export interface CheckResult {
  messages: string[];
  reviewComments: Array<{
    path: string;
    position: number;
    body: string;
  }>;
}