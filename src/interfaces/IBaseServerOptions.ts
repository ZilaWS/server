import type { IncomingHttpHeaders } from "node:http";
import { Server as HttpServer } from "node:http";
import type { Server as HttpsServer } from "node:https";

export default interface IBaseServerOptions {
  server?: HttpServer | HttpsServer;
  headerEvent: ((recievedHeaders: IncomingHttpHeaders) => Array<string> | void) | undefined;
}
