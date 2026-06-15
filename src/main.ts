import { run } from "probot";
import app from "./index.ts";

const isDenoDeploy = Deno.env.get("DENO_DEPLOYMENT_ID") !== undefined;

if (!isDenoDeploy) {
    await import("https://deno.land/x/dotenv@v3.2.0/load.ts");
}

await run(app, {
    env: Deno.env.toObject(),
});

