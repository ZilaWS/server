import { WebSocketServer } from "ws";
import IServerWrapperEvents from "../interfaces/IServerWrapperEvents";
import IClientWrapper from "../interfaces/IClientWrapper";
import IBaseServerOptions from "../interfaces/IBaseServerOptions";
import { IncomingMessage, Server as HttpServer, createServer as createServerHTTP } from "node:http";
import { Server as HttpsServer, createServer as createServerHTTPS } from "node:https";
import { readFileSync } from "fs";
import { CloseCodes, IServerSettings, WSStatus } from "..";
import ServerWrapper from "./ServerWrapper";
import IncomingMessageWrapper from "./IncomingMessageWrapper";

export default class NodeServerWrapper extends ServerWrapper {
  private wss: WebSocketServer;
  private baseServer: HttpServer | HttpsServer;

  public readonly baseWssOptions: IBaseServerOptions;

  public get clients(): Set<IClientWrapper> {
    // Return a new Set to prevent external modification of the internal set
    return new Set(this.wss.clients as unknown as Set<IClientWrapper>);
  }

  constructor(settings: IServerSettings, baseWssOptions: IBaseServerOptions) {
    super(settings);

    this.baseWssOptions = { ...baseWssOptions, server: undefined };

    this.wss = new WebSocketServer({ noServer: true });

    if (settings.https) {
      //If HTTPS server config is specified, an HTTPS server will be created.
      this.baseServer = createServerHTTPS({
        cert: readFileSync(settings.https.pathToCert),
        key: readFileSync(settings.https.pathToKey),
        passphrase: settings.https.passphrase,
      }).listen(settings.port, settings.host);
    } else {
      this.baseServer = createServerHTTP().listen(settings.port, settings.host);
    }

    /* istanbul ignore next */
    this.baseServer.on("request", (req, res) => {
      // cookieSync endpoint: delegate processing to ZilaServer via emitted event
      if (req.url && req.url.toLowerCase().startsWith("/zilaws/cookiesync")) {
        const originHeader = req.headers.origin as string | undefined;
        const allowedList = this.settings.cookieSyncAllowedOrigins;
        let allowOrigin: string | undefined;
        if (!allowedList || allowedList.length === 0) {
          // Backwards compatible: reflect (legacy behavior) if option not set
          allowOrigin = originHeader || "http://127.0.0.1:" + settings.port;
        } else if (allowedList.includes("*")) {
          allowOrigin = originHeader || "*";
        } else if (originHeader && allowedList.includes(originHeader)) {
          allowOrigin = originHeader;
        }

        if (allowOrigin) {
          res.setHeader("Access-Control-Allow-Origin", allowOrigin);
          res.setHeader("Vary", "Origin");
          res.setHeader("Access-Control-Allow-Credentials", "true");
          res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
          res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        } else if (originHeader) {
          // Origin explicitly disallowed
          res.writeHead(403, { "Content-Type": "text/plain" });
          res.end("Origin not allowed");
          return;
        }

        if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }

        if (req.method === "GET") {
          // Build a minimal response; listeners can mutate headers array via 'headers' event already, so here we just parse
          const cookieHeader = req.headers["cookie"] as string | undefined;
          const payload = { type: "cookieSync", ip: req.socket.remoteAddress, cookies: cookieHeader };
          // Emit a synthetic event the ZilaServer will listen for through wrapper 'emit'
          this.emit("cookieSync" as any, payload, (setCookieHeaders?: string[]) => {
            if (setCookieHeaders && setCookieHeaders.length) {
              for (const h of setCookieHeaders) {
                res.setHeader("Set-Cookie", setCookieHeaders);
              }
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
          });
          return;
        }
      }

      if (this.settings.rejectBannedIpBeforeConnectionUpgrade) {
        if (!req.socket.remoteAddress) return;
        const reason = this.bannedIpsAndReasons.get(req.socket.remoteAddress);
        if (!reason) return;
        res.writeHead(403, reason);
        res.end();
      }
    });

    // Forward headers event to allow external push of headers
    if (this.baseWssOptions.headerEvent) {
      const hde = this.baseWssOptions.headerEvent;
      this.wss.on("headers", (headers: string[], request: IncomingMessage) => {
        const ret = hde(request.headers);
        if (Array.isArray(ret)) headers.push(...ret);
      });
    }

    // Wire base server upgrade to ws server
    this.baseServer.on("upgrade", (req, socket, head) => {
      // Security check for cookie + non-browser marker
      /* istanbul ignore next */
      if (req.headers["set-cookie"] != undefined && req.headers["s-type"] == "1") {
        socket.write(`HTTP/1.1 403 Forbidden\r\n`);
        socket.write(`Content-Type: text/plain\r\n`);
        socket.end();
        return;
      }

      this.wss.handleUpgrade(req, socket, head, (client) => {
        const reqWrap = new IncomingMessageWrapper(req.headers, {
          remoteAddress: req.socket.remoteAddress,
          remotePort: req.socket.remotePort,
        });
        // Emit using IRequestWrapper to conform to IServerWrapperEvents
        this.wss.emit("connection", client, reqWrap as unknown as IncomingMessage);
      });
    });

    // instanbul ignore next
    this.baseServer.addListener("close", () => {
      this.baseServer.closeAllConnections();
    });

    // Set status to OPEN once the server is ready
    this._status = WSStatus.OPEN;
  }

  public emit(eventName: string | symbol, ...args: any[]): boolean {
    return this.wss.emit(eventName, ...args);
  }

  public addListener<K extends keyof IServerWrapperEvents>(events: K, callback: IServerWrapperEvents[K]) {
    this.wss.addListener(events as any, callback as any);
  }

  public close(reason?: string) {
    if (this._status === WSStatus.CLOSED || this._status === WSStatus.ERROR) {
      throw new Error("The server is not running");
    }

    this._status = WSStatus.CLOSED;

    // Gracefully signal clients first
    for (const client of this.wss.clients) {
      try {
        client.close(CloseCodes.NORMAL, reason ?? "The server has been stopped.");
      } catch {}
    }

    // Remove listeners to break potential retain cycles
    try {
      this.baseServer.removeAllListeners("request");
      this.baseServer.removeAllListeners("upgrade");
      this.baseServer.removeAllListeners("close");
      this.wss.removeAllListeners();
    } catch {}

    // Attempt graceful ws close
    try {
      this.wss.close();
    } catch {}

    // Close underlying HTTP(S) server
    try {
      this.baseServer.close(() => {});
    } catch {}

    // Force terminate lingering sockets (best effort)
    try {
      this.baseServer.closeAllConnections();
    } catch {}
  }

  public async closeAsync(reason?: string) {
    if (this._status === WSStatus.CLOSED || this._status === WSStatus.ERROR) {
      throw new Error("The server is not running");
    }
    this._status = WSStatus.CLOSED;

    for (const client of this.wss.clients) {
      try {
        client.close(CloseCodes.NORMAL, reason ?? "The server has been stopped.");
      } catch {}
    }

    this.baseServer.removeAllListeners("request");
    this.baseServer.removeAllListeners("upgrade");
    this.baseServer.removeAllListeners("close");
    this.wss.removeAllListeners();

    await Promise.allSettled([
      new Promise<void>((res) => {
        this.wss.close(() => res());
      }),
      new Promise<void>((res) => {
        this.baseServer.close(() => res());
      }),
    ]);

    this.baseServer.closeAllConnections();
  }
}
