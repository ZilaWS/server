/**
 * @file ZilaWS
 * @module ZilaWS
 * @license
 * MIT License
 * Copyright (c) 2023 ZilaWS
 */
import { type WebSocket as WebSocketClient } from "ws";
import type { IncomingHttpHeaders } from "node:http";
import { ILogger, VerboseLogger, SimpleLogger } from "./verboseLogger";
import ZilaClient from "./ZilaClient";
import { CloseCodes, WSStatus } from "./enums";
import { IWSMessage } from "./interfaces/IWSMessage";
import type { ZilaWSCallback } from "./ZilaWSCallback";
import { parse as parseCookie } from "cookie";

// Import server wrappers
import ServerWrapper from "./wrappers/ServerWrapper";
import NodeServerWrapper from "./wrappers/NodeServerWrapper";
import BunServerWrapper from "./wrappers/BunServerWrapper";
import IBaseServerOptions from "./interfaces/IBaseServerOptions";
import IClientWrapper from "./interfaces/IClientWrapper";
import IRequestWrapper from "./interfaces/IRequestWrapper";

export interface IServerSettings {
  /**
   * The port of the WebSocket server
   */
  port: number;
  /**
   * When ran with Bun, this option allows multiple processes to bind to the same port. This is useful for load-balancing.
   */
  reusePort?: boolean;
  /**
   * Set this if you want to secure the connection
   */
  https?: {
    /**
     * The path to the certificate file.
     * Supports: .pem
     */
    pathToCert: string;
    /**
     * The path to the certificate key file.
     * Supports: .pem
     */
    pathToKey: string;
    /**
     * The password which the certificate is encrypted with.
     */
    passphrase?: string;
    /**
     * Whether to allow the use self-signed certificates.
     */
    allowSelfSigned?: boolean;
  };
  /**
   * Enables verbose logging
   */
  verbose?: boolean;
  /**
   * * You can override the server's default *Logger* system by giving this property an [ILogger](https://zilaws.com/docs/server-api/config#logger) interface.
   * If you give set true, the default logging script will be used.
   */
  logger?: boolean | ILogger;
  /**
   * Sets the host for the server
   */
  host?: string;

  /**
   * This event handler gets called before a new WS connection would be created.
   * If you want to add new headers to the upgrade frame's reponse, return them as an array.
   * @returns {Array<string>}
   */
  headerEvent?: (recievedHeaders: IncomingHttpHeaders) => Array<string> | void;

  /**
   * The maximal waiting time for waiters.
   * Defaults to 800ms
   */
  maxWaiterTime?: number;

  /**
   * Custom client class
   */
  clientClass?: new (
    socket: WebSocketClient,
    ip: string | undefined,
    server: ZilaServer,
    isBrowser: boolean,
    headers: { [name: string]: string },
    cookies?: Map<string, string>
  ) => ZilaClient;

  /**
   * Rejects an incoming connection if its IP's banned before upgrading the HTTP connnection to WS
   * **Warning:** If this option is turned on, and ZilaWS is ran and/or is accessed with Bun, in most cases the client will not recieve the ban message from the server.
   */
  rejectBannedIpBeforeConnectionUpgrade?: boolean;

  /**
   * Restricts which HTTP origins may access the /zilaws/cookieSync endpoint (CORS).
   * If omitted, the server will reflect the Origin header (previous insecure behavior).
   * If provided:
   *  - Use an array of allowed exact origin strings (e.g. ["https://app.example.com", "http://localhost:3000"]).
   *  - The special value "*" inside the array will allow any origin (not recommended when credentials are involved).
   * Matching is case-sensitive and must be an exact string match.
   */
  cookieSyncAllowedOrigins?: string[];
}

export interface IServerEvents<T extends ZilaClient> {
  /**
   * Runs every time a client connects.
   * @param socket
   * @param req
   * @returns
   */
  onClientConnect: (socket: T) => void;

  /**
   * Runs every time a client disconnects
   * @param socket
   * @param code
   * @param reason
   * @returns
   */
  onClientDisconnect: (socket: T, code: number, reason: string) => void;

  /**
   * Runs every time after a the server processes a message from the client.
   * @param socket
   * @param eventHandlerName The name of the event handler callback
   * @param message If the message object is instance of T, this param will be T, undefined if not.
   * @returns
   */
  onClientMessage: <T>(socket: T, eventHandlerName: string, messageDataObject: T | undefined) => void;

  /**
   * Runs every time a server recieves a message from the client before any registered callback could run
   * @param socket
   * @param eventHandlerName The name of the event handler callback
   * @param message If the message object is instance of T, this param will be T, undefined if not.
   * @returns
   */
  onClientMessageBeforeCallback: <U>(
    socket: T,
    eventHandlerName: string,
    messageDataObject: U | undefined
  ) => void;

  /**
   * Runs every time a server recieves a message from the client before any registered callback could run.
   * @param socket
   * @param rawMessage Not processed, raw message from the client. (Hopefully JSON)
   * @returns
   */
  onClientRawMessageBeforeCallback: (socket: T, rawMessage: string) => void;
}

/**
 * Detects the runtime environment and returns the appropriate server wrapper
 */
function createServerWrapper(settings: IServerSettings): ServerWrapper {
  const baseWssOptions: IBaseServerOptions = {
    headerEvent: settings.headerEvent,
  };

  // Check if we're running in Bun
  try {
    // Use globalThis to avoid TypeScript errors
    if (typeof (globalThis as any).Bun !== "undefined") {
      // istanbul ignore next
      return new BunServerWrapper(settings, baseWssOptions);
    }
  } catch {
    // Ignore errors and fall through to Node.js
  }

  // Default to Node.js
  return new NodeServerWrapper(settings, baseWssOptions);
}

export class ZilaServer<T extends ZilaClient = ZilaClient> {
  public serverWrapper: ServerWrapper;
  VerbLog?: ILogger;
  Logger?: ILogger;
  maxWaiterTime = 800;

  private clientClass: new (
    socket: WebSocketClient,
    ip: string | undefined,
    server: ZilaServer<T>,
    isBrowser: boolean,
    headers: { [name: string]: string },
    cookies?: Map<string, string>
  ) => ZilaClient;

  private serverEvents: {
    [K in keyof IServerEvents<T>]?: Array<IServerEvents<T>[K]> | undefined;
  } = {};

  private readonly callbacks: { [id: string]: ZilaWSCallback<ZilaClient> | undefined } = {};

  private readonly bannedIpsAndReasons: Map<string, string | undefined> = new Map();

  public get status() {
    return this.serverWrapper.status;
  }

  private _clients: Array<ZilaClient | T> = [];

  public get clients() {
    return this._clients;
  }

  public readonly settings: IServerSettings;

  /* istanbul ignore next */
  private async getNewestVersion(): Promise<string> {
    const data = JSON.parse(
      await (
        await fetch("https://registry.npmjs.org/zilaws-server/latest/", {
          method: "GET",
        })
      ).text()
    );
    return data["version"];
  }

  public constructor(settings: IServerSettings) {
    this.settings = settings;
    // @ts-ignore
    this.clientClass = settings.clientClass ?? ZilaClient;
    if (settings.maxWaiterTime) this.maxWaiterTime = settings.maxWaiterTime;

    if (settings.verbose) {
      this.VerbLog = VerboseLogger;
      this.VerbLog.log(
        "Verbose logging is enabled. WS error codes' documentation: https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent/code"
      );
    }

    if (settings.logger !== undefined) {
      if (typeof settings.logger == "boolean" && settings.logger) {
        this.Logger = SimpleLogger;
      }
    }

    this.Logger?.log("Starting server...");

    // Create the appropriate server wrapper based on runtime
    this.serverWrapper = createServerWrapper(settings);

    // Inject the banned IPs map
    this.serverWrapper.setServerWrapper(this.bannedIpsAndReasons);

    // Set up event listeners
    this.serverWrapper.addListener("connection", this.handleConnection.bind(this));
    this.serverWrapper.addListener("close", this.handleServerClose.bind(this));
    this.serverWrapper.addListener("error", this.handleServerError.bind(this));
    // Custom internal event emitted by wrappers for /zilaws/cookieSync
    (this.serverWrapper as any).addListener?.(
      "cookieSync",
      (payload: any, respond: (setHeaders?: string[]) => void) => {
        const headers = this.processCookieSync(payload.ip, payload.cookies);
        respond(headers);
      }
    );

    this.Logger?.log(
      `Ready for incoming connections on port ${settings.port} with SSL ${
        settings.https ? "enabled" : "disabled"
      }.`
    );
  }

  private handleConnection(socket: IClientWrapper, request: IRequestWrapper): void {
    // Check if IP is banned
    const clientIP = request.socket.remoteAddress;
    if (clientIP) {
      const reason = this.bannedIpsAndReasons.get(clientIP);
      if (reason !== undefined) {
        socket.close(CloseCodes.BANNED, reason);
        return;
      }
    }

    this.Logger?.log(`A client has connected: ${clientIP}:${request.socket.remotePort}`);

    // Initial cookies from upgrade
    const initialCookies = request.headers.cookie
      ? new Map<string, string>(Object.entries(parseCookie(request.headers.cookie as string)))
      : new Map<string, string>();

    // No previously synced shared store (feature reverted)

    let zilaSocket = new this.clientClass(
      socket as any,
      clientIP,
      this,
      request.headers["s-type"] != "1",
      request.headers as { [name: string]: string },
      initialCookies
    );

    this._clients.push(zilaSocket);

    if (this.serverEvents.onClientConnect) {
      for (const cb of this.serverEvents.onClientConnect) {
        cb(zilaSocket as T);
      }
    }

    // Set up message handler
    socket.addListener("message", (data: any) => {
      const datastring = data.toString();
      if (this.serverEvents.onClientRawMessageBeforeCallback) {
        for (const cb of this.serverEvents.onClientRawMessageBeforeCallback) {
          cb(zilaSocket as T, datastring);
        }
      }

      this.VerbLog?.log(`Message recieved: ${clientIP}:${request.socket.remotePort}\nData:${datastring}`);
      this.callMessageHandler(zilaSocket, request, datastring);
    });

    // Set up close handler
    socket.addListener("close", (event: any) => {
      // Remove client from the list
      const index = this._clients.indexOf(zilaSocket);
      if (index > -1) {
        this._clients.splice(index, 1);
      }

      if (this.serverEvents.onClientDisconnect) {
        for (const cb of this.serverEvents.onClientDisconnect) {
          cb(zilaSocket as T, event.code || 1000, event.reason || "");
        }
      }

      if (this.VerbLog) {
        this.VerbLog.log(
          `A client has been disconnected. IP: ${clientIP}:${request.socket.remotePort} | Code: ${event.code || 1000} | wasClean: ${event.wasClean || true}`
        );
      } else if (this.Logger) {
        this.Logger.log(`A client has been disconnected. IP: ${clientIP}:${request.socket.remotePort}`);
      }
    });

    // Set up error handler
    if (this.VerbLog) {
      socket.addListener("error", (error: Error) => {
        this.VerbLog?.error(
          `An error has occured: IP: ${clientIP}:${request.socket.remotePort} | Message: ${error.message}\n${error.stack}`
        );
      });
    }
  }

  private handleServerClose(): void {
    this.Logger?.log("The server has closed.");
  }

  private handleServerError(err: Error): void {
    this.Logger?.error(`An error has occured: ${err.stack}`);
  }

  /**
   * Re-applies the shared cookie store (if any) to all clients matching the same IP + user-agent key.
   * Intended to be called externally after an HTTP /zilaws/cookieSync request completes (userland can call it),
   * but not strictly necessary for first implementation since new connections already merge the store.
   */
  public refreshClientCookiesFor(ip: string | undefined, userAgent: string | undefined) {
    // no-op after design change (kept for backward compatibility)
    return;
  }

  /** Internal hook used by wrappers: cookieSync endpoint */
  private processCookieSync(ip: string | undefined, rawCookieHeader: string | undefined): string[] | undefined {
    if (!ip) return undefined;
    const targetClients = this._clients.filter((c) => c.ip === ip);
    if (!targetClients.length) return undefined;
    const newCookies = rawCookieHeader
      ? new Map<string, string>(Object.entries(parseCookie(rawCookieHeader)))
      : new Map<string, string>();

    const setCookieHeaders: string[] = [];
    for (const c of targetClients) {
      for (const [k, v] of newCookies.entries()) {
        if (!c.cookies.has(k)) {
          (c as any)._cookies.set(k, v);
        }
      }
      // compute diff to send back (currently server does not add new cookies beyond existing internal map)
      // If server had cookies not present in the header, we send them back
      for (const [k, v] of (c as any)._cookies.entries()) {
        if (!newCookies.has(k)) {
          setCookieHeaders.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
        }
      }
    }
    return setCookieHeaders.length ? setCookieHeaders : undefined;
  }

  // (Removed duplicate constructor introduced by refactor)

  /**
   * Creates a new event listener that runs every time an event occurs which it got registered to.
   * @param eventType
   * @param callback
   */
  public addEventListener<K extends keyof IServerEvents<T>>(eventType: K, callback: IServerEvents<T>[K]) {
    let arr = this.serverEvents[eventType];
    if (!arr) {
      arr = [];
    } else if (arr.includes(callback)) {
      throw new Error(`${eventType} listener already has this callback added to it.`);
    }

    arr.push(callback);
    this.serverEvents[eventType] = arr;
  }

  /**
   * Removes a specific callback from the specified event type.
   * @param eventType
   * @param callback
   * @returns
   */
  public removeEventListener<K extends keyof IServerEvents<T>>(eventType: K, callback: IServerEvents<T>[K]) {
    let arr = this.serverEvents[eventType];
    if (!arr) return;

    const id = arr.indexOf(callback);
    if (id == -1) return;

    arr.splice(id, 1);
    if (arr.length == 0) delete this.serverEvents[eventType];
  }

  /**
   * Creates a new event listener that runs once an event occurs which it got registered to.
   *
   * The registered callback only runs once then removes itself.
   * @param eventType
   * @param callback
   */
  public onceEventListener<K extends keyof IServerEvents<T>>(eventType: K, callback: IServerEvents<T>[K]) {
    const that = this;

    function onceCallback(...args: any[]) {
      that.removeEventListener(eventType, onceCallback);
      (callback as Function)(...args);
    }

    this.addEventListener(eventType, onceCallback);
  }

  /**
   * Calls an eventhandler on the client-side for the specified client.
   * @param {this.clientClass} socket The websocket client
   * @param {string} identifier The callback's name on the client-side.
   * @param {any|undefined} data Arguments that shall be passed to the callback as parameters (optional)
   */
  public send(socket: ZilaClient, identifier: string, ...data: any[]): void {
    socket.send(identifier, ...data);
  }

  public broadcastSend(identifier: string, ...data: any[]): void {
    for (const client of this.serverWrapper.clients) {
      const msg: IWSMessage = {
        callbackId: null,
        message: data,
        identifier: identifier,
      };

      client.send(JSON.stringify(msg));
    }
  }

  /**
   * Calls an eventhandler on the client-side for the specified client. Gets a value of T type back from the client or just waits for the eventhandler to finish.
   * If the client doesn't respond in
   * @param {T} socket The websocket client
   * @param {string} identifier The callback's name on the client-side.
   * @param {any|undefined} data Arguments that shall be passed to the callback as parameters (optional)
   * @returns {Promise<T | undefined>}
   */
  public waiter<T>(socket: ZilaClient, identifier: string, ...data: any[]): Promise<T | undefined> {
    return socket.waiter<T>(identifier, ...data);
  }

  /**
   * Calls an eventhandler on the client-side for the specified client. Gets a value of T type back from the client or just waits for the eventhandler to finish.
   * @param {T} socket The websocket client
   * @param {string} identifier The callback's name on the client-side.
   * @param {number} maxWaitingTime The maximum time this waiter will wait for the client. Defaults to the server's maxWaiterTime.
   * @param {any|undefined} data Arguments that shall be passed to the callback as parameters (optional)
   * @returns {Promise<T | undefined>}
   */
  public waiterTimeout<T>(
    socket: ZilaClient,
    identifier: string,
    maxWaitingTime: number,
    ...data: any[]
  ): Promise<T | undefined> {
    return socket.waiterTimeout<T>(identifier, maxWaitingTime, ...data);
  }

  /**
   * Sends a waiter event to all of the connected clients
   * The maxWaiting time is the server's maxWaiterTime
   * @param identifier
   * @param data
   * @returns {Promise<Array<T>>}
   */
  public async broadcastWaiter<T>(identifier: string, ...data: any[]): Promise<Array<T>> {
    const promises: Array<Promise<T | undefined>> = [];

    for (const socket of this._clients) {
      promises.push(socket.waiter<T | undefined>(identifier, ...data));
    }

    const settled = await Promise.allSettled<T | undefined>(promises);

    let responses: Array<T> = [];

    for (const resp of settled) {
      if (resp.status == "fulfilled" && resp.value !== undefined) {
        responses.push(resp.value);
      }
    }

    return responses;
  }

  /**
   * Sends a waiter event to all of the connected clients.
   * @param identifier
   * @param data
   * @param maxWaitingTime Max waiting time for each client in miliseconds.
   * @returns {Promise<Array<T>>}
   */
  public async broadcastWaiterTimeout<T>(
    identifier: string,
    maxWaitingTime: number,
    ...data: any[]
  ): Promise<Array<T>> {
    const promises: Array<Promise<T | undefined>> = [];

    for (const socket of this._clients) {
      promises.push(socket.waiterTimeout<T | undefined>(identifier, maxWaitingTime, ...data));
    }

    const settled = await Promise.allSettled<T | undefined>(promises);

    let responses: Array<T> = [];

    for (const resp of settled) {
      if (resp.status == "fulfilled" && resp.value !== undefined) {
        responses.push(resp.value);
      }
    }

    return responses;
  }

  /**
   * Registers an eventhandler.
   * The registered callback will run when one of the clients ask for it with the given identifier.
   * Can get overrided with using the same identifier.
   * @param identifier The eventhandler's name
   * @param callback The eventhandler
   */
  public setMessageHandler(identifier: string, callback: ZilaWSCallback<T>): void {
    this.callbacks[identifier] = callback as ZilaWSCallback<ZilaClient>;
  }

  /**
   * Removes an MessageHandler. The callback will no longer get triggered when one of the client asks for it.
   * @param identifier
   */
  public removeMessageHandler(identifier: string): void {
    delete this.callbacks[identifier];
  }

  /**
   * Registers a MessageHandler that only can be called once.
   * @param identifier
   * @param callback
   */
  public onceMessageHandler(identifier: string, callback: ZilaWSCallback<T>): void {
    this.callbacks[identifier] = (socket: ZilaClient, ...args: any[]) => {
      this.removeMessageHandler(identifier);
      return callback(socket as T, ...args);
    };
  }

  /**
   * Disconnects a client from the WS server
   * @param socket
   * @param reason The reason for this action. Will get sent down to client.
   */
  public kickClient(socket: ZilaClient, reason?: string) {
    socket.socket.close(CloseCodes.KICKED, reason);
  }

  /**
   * The server will no longer accept connections from that IP-address.
   * The list of banned IPs resets on every server restart.
   * @param socket
   * @param reason
   */
  public banClient(socket: ZilaClient, reason?: string) {
    socket.socket.close(CloseCodes.BANNED, reason);
    if (socket.ip) {
      this.bannedIpsAndReasons.set(socket.ip, reason);
    }
  }

  /**
   * Stops the ZilaWS server
   * @param reason This reason'll be sent down to all the clients.
   */
  public stopServer(reason?: string) {
    this.serverWrapper.close(reason);
  }

  /**
   * Stops the ZilaWS server asynchronously
   * @param reason This reason'll be sent down to all the clients.
   * @returns {Promise<void>}
   */
  public async stopServerAsync(reason?: string): Promise<void> {
    await this.serverWrapper.closeAsync(reason);
  }

  /**
   * Calls the given callback if the client recieves a request for it from the server.
   * @param {string} msg The raw websocket message
   */
  private async callMessageHandler(socket: ZilaClient, req: IRequestWrapper, msg: string) {
    let msgObj: IWSMessage;
    new Promise<IWSMessage>((resolve) => {
      let loc: IWSMessage;
      try {
        loc = JSON.parse(msg) as IWSMessage;
        resolve(loc);
      } catch {
        this.Logger?.warn(`Bad Message from ${req.socket.remoteAddress}:${req.socket.remotePort}`);
      }
    }).then((val) => {
      msgObj = val;

      /* istanbul ignore next */
      if (msgObj.identifier[0] != "@") {
        // No built-in inner events currently handled (cookie syncing removed)
        return;
      }

      msgObj.identifier = msgObj.identifier.slice(1);

      if (this.serverEvents.onClientRawMessageBeforeCallback) {
        for (const cb of this.serverEvents.onClientRawMessageBeforeCallback) {
          cb(socket as T, msg);
        }
      }

      if (this.serverEvents.onClientMessageBeforeCallback) {
        for (const cb of this.serverEvents.onClientMessageBeforeCallback) {
          cb(socket as T, msgObj.identifier, msgObj.message);
        }
      }

      const callback = this.callbacks[msgObj.identifier];
      if (callback !== undefined && callback !== null && msgObj.message) {
        Promise.resolve(callback(socket, ...msgObj.message)).then((val) => {
          if (msgObj.callbackId && msgObj.callbackId != null) {
            this.send(socket, msgObj.callbackId, val);
          }
        });
      }
    });
  }
}

export { ZilaClient, CloseCodes, WSStatus, IncomingHttpHeaders, WebSocketClient, ZilaWSCallback };
