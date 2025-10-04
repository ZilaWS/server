/**
 * @file ZilaWS
 * @module ZilaWS
 * @license
 * MIT License
 * Copyright (c) 2023 ZilaWS
 */

import { WebSocket as WebSocketClient } from "ws";
import { randomInt, randomUUID } from "crypto";
import { ZilaServer, WSStatus } from ".";
import type { IncomingHttpHeaders } from "node:http";
import { ICookie } from "./interfaces/ICookie";

export default class ZilaClient {
  socket: WebSocketClient;
  id: string;
  ip: string | undefined;
  server: ZilaServer;
  status: WSStatus;
  isBrowser: boolean;

  private readonly headers: IncomingHttpHeaders;

  private _cookies: Map<string, string> = new Map();
  /**
   * Exposed cookie map proxy (immutable reference semantics; controlled via set/delete wrappers)
   */
  private _cookiesProxy: Pick<
    Map<string, string>,
    "get" | "set" | "delete" | "has" | "forEach" | "entries" | "keys" | "values"
  > = null as any;

  /**
   * Cookies of the client's browser. Must be URI encoded.
   * Only contains cookies which were present while establishing the connection and which were set by ZilaWS.
   */
  /* istanbul ignore next */
  public get cookies() {
    if (!this._cookiesProxy) {
      const that = this;
      this._cookiesProxy = {
        get(key: string) {
          return that._cookies.get(key);
        },
        set(key: string, value: string) {
          that._cookies.set(key, value);
          // trigger client-side sync request (built-in message instructs runtime to perform HTTP GET cookieSync)
          that.bSend("COOKIE_SYNC_REQUEST");
          return this as any;
        },
        delete(key: string) {
          const existed = that._cookies.delete(key);
          if (existed) that.bSend("COOKIE_SYNC_REQUEST");
          return existed;
        },
        has(key: string) {
          return that._cookies.has(key);
        },
        forEach(cb: any, thisArg?: any) {
          return that._cookies.forEach(cb, thisArg);
        },
        entries() {
          return that._cookies.entries();
        },
        keys() {
          return that._cookies.keys();
        },
        values() {
          return that._cookies.values();
        },
      };
    }
    return this._cookiesProxy;
  }

  /**
   * Internal use: merges provided cookies into the client's cookie map (overwrite existing values).
   * Exposed without documentation to avoid public API bloat; used by server refresh.
   */
  /* istanbul ignore next */
  public __mergeCookies(cookies: Map<string, string>) {
    for (const [k, v] of cookies.entries()) this._cookies.set(k, v);
  }

  /**
   * *You must not use this constructor!*
   *
   * Inner part of ZilaWS.
   * @param socket
   * @param ip
   * @param server
   */
  constructor(
    socket: WebSocketClient,
    ip: string | undefined,
    server: ZilaServer,
    isBrowser: boolean,
    headers: IncomingHttpHeaders,
    cookies?: Map<string, string>
  ) {
    this.socket = socket;
    this.id = new Date(Date.now()).toISOString() + randomInt(0, 100);
    this.ip = ip;
    this.server = server;
    this.status = socket.readyState;
    if (cookies) this._cookies = cookies;
    this.isBrowser = isBrowser;
    this.headers = headers;
  }

  // Cookie syncing removed: cookies are now only read from the initial HTTP upgrade request.

  // setCookie/removeCookie deprecated: runtime cookie mutation removed. Keeping methods as no-ops for backwards compatibility.
  /** @deprecated Cookie mutation after upgrade removed. Cookies are immutable; only initial upgrade request cookies available. */
  /* istanbul ignore next */
  public setCookie(_cookie: ICookie) {
    return; // no-op
  }

  /** @deprecated Cookie mutation after upgrade removed. Cookies are immutable; only initial upgrade request cookies available. */
  /* istanbul ignore next */
  public removeCookie(_cookieName: string) {
    return; // no-op
  }

  /**
   * Returns a JSON serialized message object.
   * @param identifier
   * @param data
   * @param callbackId
   * @param isBuiltIn
   * @returns
   */
  private getMessageJSON(
    identifier: string,
    data: any[] | null,
    callbackId: string | null,
    isBuiltIn: boolean = false
  ): string {
    /* istanbul ignore next */
    return JSON.stringify({
      identifier: isBuiltIn ? "@" + identifier : identifier,
      message: data,
      callbackId: callbackId,
    });
  }

  /**
   * Calls an eventhandler on the client-side for the specified client.
   * @param {string} identifier The callback's name on the client-side.
   * @param {any|undefined} data Arguments that shall be passed to the callback as parameters (optional)
   */
  public send(identifier: string, ...data: any[]) {
    this.socket.send(this.getMessageJSON(identifier, data, null));
  }

  /**
   * Send function for built-in systems
   * @param {string} identifier The callback's name on the client-side.
   * @param {any|undefined} data Arguments that shall be passed to the callback as parameters (optional)
   */
  /* istanbul ignore next */
  private bSend(identifier: string, ...data: any[]) {
    this.socket.send(this.getMessageJSON(identifier, data, null, true));
  }

  /**
   * Calls an eventhandler on the client-side for the specified client. Gets a value of T type back from the client or just waits for the eventhandler to finish.
   * The max waiting time is the server's maxWaiterTime
   * @param {string} identifier The callback's name on the client-side.
   * @param {any|undefined} data Arguments that shall be passed to the callback as parameters (optional)
   * @returns {Promise<T | undefined>}
   */
  public waiter<T>(identifier: string, ...data: any[]): Promise<T | undefined> {
    return new Promise(async (resolve) => {
      const uuid = randomUUID();

      let timeout: NodeJS.Timeout;

      resolve(
        Promise.any([
          new Promise((r) => {
            this.setMessageHandler(uuid, (args: any[]): void => {
              clearTimeout(timeout);
              this.removeMessageHandler(uuid);
              r(args);
            });
          }),
          new Promise((_r, rej) => {
            timeout = setTimeout(() => {
              _r(undefined);
            }, this.server.maxWaiterTime);
          }),
        ]) as Promise<T | undefined>
      );

      this.socket.send(this.getMessageJSON(identifier, data, uuid));
    });
  }

  /**
   * Calls an eventhandler on the client-side for the specified client. Gets a value of T type back from the client or just waits for the eventhandler to finish.
   * @param {string} identifier The callback's name on the client-side.
   * @param {number} maxWaitingTime The maximum time this waiter will wait for the client.
   * @param {any|undefined} data Arguments that shall be passed to the callback as parameters (optional)
   * @returns {Promise<T | undefined>}
   */
  public waiterTimeout<T>(identifier: string, maxWaitingTime: number, ...data: any[]): Promise<T | undefined> {
    return new Promise(async (resolve) => {
      const uuid = randomUUID();

      let timeout: NodeJS.Timeout;

      resolve(
        Promise.any([
          new Promise((r) => {
            this.setMessageHandler(uuid, (args: any[]): void => {
              clearTimeout(timeout);
              this.removeMessageHandler(uuid);
              r(args);
            });
          }),
          new Promise((_r, rej) => {
            timeout = setTimeout(() => {
              _r(undefined);
            }, maxWaitingTime);
          }),
        ]) as Promise<T | undefined>
      );

      this.socket.send(this.getMessageJSON(identifier, data, uuid));
    });
  }

  /**
   * Registers an eventhandler.
   * The registered callback will run when one of the clients ask for it with the given identifier.
   * Can get overrided with using the same identifier.
   * @param identifier The eventhandler's name
   * @param callback The eventhandler
   */
  public setMessageHandler(identifier: string, callback: (...args: any[]) => void) {
    return this.server.setMessageHandler(identifier, (_, ...args: any[]) => {
      callback(...args);
    });
  }

  /**
   * Registers a MessageHandler that only can be called once.
   * @param identifier
   * @param callback
   */
  public onceMessageHandler(identifier: string, callback: (...args: any[]) => void) {
    return this.server.onceMessageHandler(identifier, (_, ...args) => {
      return callback(...args);
    });
  }

  /**
   * Removes an MessageHandler. The callback will no longer get triggered when one of the client asks for it.
   * @param identifier
   */
  public removeMessageHandler(identifier: string) {
    return this.server.removeMessageHandler(identifier);
  }

  /**
   * Disconnects a client from the WS server
   * @param reason The reason for this action. Will get sent down to client.
   */
  public kick(reason?: string) {
    this.server.kickClient(this, reason);
  }

  /**
   * The server will no longer accept connections from that IP-address.
   * The list of banned IPs resets on every server restart.
   * @param reason The reason for this action. Will get sent down to client.
   */
  public ban(reason?: string) {
    this.server.banClient(this, reason);
  }
}
