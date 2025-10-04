import IServerWrapperEvents from "../interfaces/IServerWrapperEvents";
import IClientWrapper from "../interfaces/IClientWrapper";
import IBaseServerOptions from "../interfaces/IBaseServerOptions";
import { CloseCodes, IServerSettings, WSStatus } from "..";
import ServerWrapper from "./ServerWrapper";
import IncomingMessageWrapper from "./IncomingMessageWrapper";
import "../overrides/BunServerWebsocket";
import { SimpleLogger, VerboseLogger } from "../verboseLogger";

interface IWebSocketData {
  headers: {
    [name: string]: string | string[] | undefined;
  };
  id: string;
}

/**
 * Bun-specific wrapper for ServerWebSocket to implement IClientWrapper interface
 */
class BunClientWrapper implements IClientWrapper {
  private eventListeners: Map<string, Function[]> = new Map();
  constructor(private ws: Bun.ServerWebSocket<IWebSocketData>) {}

  send(data: any): void {
    this.ws.send(data);
  }

  close(code?: number, reason?: string): void {
    this.ws.close(code, reason);
  }

  addEventListener(event: string, listener: (...args: any[]) => void): void {
    const listeners = this.eventListeners.get(event) || [];
    listeners.push(listener);
    this.eventListeners.set(event, listeners);
  }

  addListener(event: string, listener: (...args: any[]) => void): void {
    this.addEventListener(event, listener);
  }

  emit(event: string | symbol, ...args: any[]): void {
    if (this.eventListeners) {
      const listeners = this.eventListeners.get(event as string) || [];
      listeners.forEach((listener: Function) => {
        try {
          listener(...args);
        } catch (error) {
          console.error(`Error in client event listener for ${String(event)}:`, error);
        }
      });
    }
  }

  on(event: string, listener: (...args: any[]) => void): void {
    this.addEventListener(event, listener);
  }
}

export default class BunServerWrapper extends ServerWrapper {
  private server: Bun.Server = null!;
  private connectedClients: Map<string, IClientWrapper> = new Map();
  private eventListeners: Map<string, Function[]> = new Map();

  public readonly baseWssOptions: IBaseServerOptions;

  public get clients(): Set<IClientWrapper> {
    return new Set(this.connectedClients.values());
  }

  constructor(settings: IServerSettings, baseWssOptions: IBaseServerOptions) {
    super(settings);
    this.baseWssOptions = { ...baseWssOptions, server: undefined };

    if (typeof Bun === "undefined") {
      throw new Error("BunServerWrapper can only be used in Bun runtime environment");
    }

    try {
      this.server = Bun.serve<IWebSocketData, {}>({
        port: settings.port,
        reusePort: settings.reusePort,
        hostname: settings.host,
        tls: this.settings.https
          ? {
              cert: Bun.file(this.settings.https.pathToCert),
              key: Bun.file(this.settings.https.pathToKey),
              passphrase: this.settings.https.passphrase,
              rejectUnauthorized: !this.settings.https.allowSelfSigned,
            }
          : {},
        fetch: this.handleFetch.bind(this),
        websocket: {
          message: this.handleMessage.bind(this),
          open: this.handleOpen.bind(this),
          close: this.handleClose.bind(this),
        },
        error: this.handleError,
      });

      this._status = WSStatus.OPEN;
    } catch (error) {
      this._status = WSStatus.ERROR;
      throw new Error(`Failed to start Bun server: ${error}`);
    }
  }

  private handleFetch(req: Request): Response | Promise<Response> {
    let clientIP = this.server.requestIP(req);

    if (this.settings.rejectBannedIpBeforeConnectionUpgrade) {
      const banReason = clientIP?.address ? this.bannedIpsAndReasons.get(clientIP.address) : undefined;
      if (banReason !== undefined) {
        return new Response(`Client has been banned: ${banReason ?? ""}`, {
          status: 403,
          statusText: `Client has been banned: ${banReason ?? ""}`,
        });
      }
    }

    // Security check for cookie + non-browser marker
    const setCookie = req.headers.get("set-cookie");
    const sType = req.headers.get("s-type");
    if (setCookie && sType === "1") {
      return new Response("Forbidden", { status: 403 });
    }

    // Handle WebSocket upgrade
    if (req.headers.get("upgrade") === "websocket") {
      const headersObject = this.headersToObject(req.headers);
      this.baseWssOptions.headerEvent?.call(this, headersObject);

      const success = this.server.upgrade(req, {
        data: {
          headers: headersObject,
          remoteAddress: clientIP,
          remotePort: 0,
          id: crypto.randomUUID(),
        },
      });

      if (success) {
        return undefined as any; // Upgrade successful, Bun will continue with WS lifecycle
      }
      return new Response("Failed to upgrade to WebSocket", { status: 400 });
    }

    // Cookie sync endpoint delegate
    if (new URL(req.url).pathname.toLowerCase() === "/zilaws/cookiesync") {
      const method = req.method.toUpperCase();
      const originHeader = req.headers.get("origin") || undefined;
      const allowedList = this.settings.cookieSyncAllowedOrigins;
      let allowOrigin: string | undefined;
      if (!allowedList || allowedList.length === 0) {
        allowOrigin = originHeader ?? "http://127.0.0.1:" + this.settings.port;
      } else if (allowedList.includes("*")) {
        allowOrigin = originHeader || "*";
      } else if (originHeader && allowedList.includes(originHeader)) {
        allowOrigin = originHeader;
      }

      if (!allowOrigin && originHeader) {
        return new Response("Origin not allowed", { status: 403 });
      }

      const baseHeaders: [string, string][] = [];
      if (allowOrigin) {
        baseHeaders.push(["Access-Control-Allow-Origin", allowOrigin]);
        baseHeaders.push(["Vary", "Origin"]);
        baseHeaders.push(["Access-Control-Allow-Credentials", "true"]);
        baseHeaders.push(["Access-Control-Allow-Methods", "GET,OPTIONS"]);
        baseHeaders.push(["Access-Control-Allow-Headers", "Content-Type"]);
      }

      if (method === "OPTIONS") {
        return new Response(null, { status: 204, headers: baseHeaders });
      }

      if (method === "GET") {
        let setCookieHeaders: string[] | undefined;
        this.emit(
          "cookieSync" as any,
          { type: "cookieSync", ip: clientIP?.address, cookies: req.headers.get("cookie") },
          (headers?: string[]) => {
            setCookieHeaders = headers;
          }
        );
        baseHeaders.push(["Content-Type", "application/json"]);
        if (setCookieHeaders) {
          for (const sc of setCookieHeaders) baseHeaders.push(["Set-Cookie", sc]);
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: baseHeaders });
      }
    }

    return new Response("WebSocket server", { status: 200 });
  }

  private handleOpen(ws: Bun.ServerWebSocket<IWebSocketData>): void {
    const clientWrapper = new BunClientWrapper(ws);
    this.connectedClients.set(ws.data.id, clientWrapper);

    const requestWrapper = new IncomingMessageWrapper(ws.data.headers, ws);
    this.emit("connection", clientWrapper, requestWrapper);
  }

  private handleMessage(ws: Bun.ServerWebSocket<IWebSocketData>, message: string | Buffer): void {
    const clientWrapper = this.connectedClients.get(ws.data.id);

    if (clientWrapper) {
      clientWrapper.emit("message", message);
    }
  }

  private handleClose(ws: Bun.ServerWebSocket<IWebSocketData>, code: number, reason: string): void {
    const clientToRemove = this.connectedClients.get(ws.data.id);

    if (clientToRemove) {
      clientToRemove.emit("close", { code, reason });
      this.connectedClients.delete(ws.data.id);
    }
  }

  private handleError(error: Bun.ErrorLike): void {
    const callbacks = this.eventListeners.get("error");
    if (!callbacks) return;

    for (let i = 0; i < callbacks?.length; i++) {
      callbacks[i].call(undefined, error);
    }
  }

  private headersToObject(headers: Headers): { [name: string]: string | string[] | undefined } {
    const obj: { [name: string]: string | string[] | undefined } = {};
    headers.forEach((value, key) => {
      const existing = obj[key];
      if (existing === undefined) {
        obj[key] = value;
      } else if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        obj[key] = [existing, value];
      }
    });
    return obj;
  }

  public emit<K extends keyof IServerWrapperEvents>(eventName: K, ...args: any[]): boolean {
    const listeners = this.eventListeners.get(eventName as string);
    if (!listeners || listeners.length === 0) {
      return false;
    }

    listeners.forEach((listener) => {
      try {
        listener.apply(this, args);
      } catch (error) {
        console.error(`Error in event listener for ${String(eventName)}:`, error);
      }
    });

    return true;
  }

  public addListener<K extends keyof IServerWrapperEvents>(events: K, callback: IServerWrapperEvents[K]): void {
    const eventName = events as string;
    const listeners = this.eventListeners.get(eventName) || [];
    listeners.push(callback as Function);
    this.eventListeners.set(eventName, listeners);
  }

  public close(reason?: string): void {
    if (this._status === WSStatus.CLOSED || this._status === WSStatus.ERROR) {
      throw new Error("The server is not running");
    }

    this._status = WSStatus.CLOSED;

    // Close all client connections
    for (const [_, client] of this.connectedClients) {
      client.close(CloseCodes.NORMAL, reason ?? "The server has been stopped.");
    }

    // Stop the Bun server
    if (this.server) {
      this.server.stop();
      this.server = {} as Bun.Server;
    }

    this.connectedClients.clear();

    // Emulate Node server 'close' event
    this.emit("close");
  }

  public async closeAsync(reason?: string): Promise<void> {
    if (this._status === WSStatus.CLOSED || this._status === WSStatus.ERROR) {
      throw new Error("The server is not running");
    }

    // Close all client connections
    const closePromises = Array.from(this.connectedClients.values()).map((client) => {
      return new Promise<void>((resolve) => {
        client.close(CloseCodes.NORMAL, reason ?? "The server has been stopped.");
        resolve();
      });
    });

    await Promise.all(closePromises);

    // Stop the Bun server
    if (this.server) {
      this.server.stop();
      this.server = {} as Bun.Server;
    }

    this.connectedClients.clear();
    this._status = WSStatus.CLOSED;

    // Emulate Node server 'close' event
    this.emit("close");
  }
}
