import { run } from "probot";
import app from "./index.ts";

const isDenoDeploy = Deno.env.get("DENO_DEPLOYMENT_ID") !== undefined;

if (!isDenoDeploy) {
  await import("dotenv");
}

await run(app, {
  env: Deno.env.toObject(),
});
