import { Server, Probot } from "probot";
import app from "./index.js";
import package_json from "../package.json";

const server = new Server({
  Probot: Probot.defaults({}),
});

await server.load(app);

server.expressApp.get('/health', (_, res) => res.send(package_json.version));

server.start();
