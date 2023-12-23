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
import Cookie from "cookie";
import { IncomingHttpHeaders } from 'http';
import { ICookie } from "./ICookie";

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
   * Cookies of the client's browser. Must be URI encoded.
   * Only contains cookies which were present while establishing the connection and which were set by ZilaWS.
   */
  /* istanbul ignore next */
  public get cookies() {
    return this._cookies;
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

  /**
   * Used to store cookies to a socket which has been recieved from the client-side for syncing.
   * @param socket The socket to store the cookies in
   * @param cookies Cookies to store
   */
  /* istanbul ignore next */
  public static StoreSyncedCookies(socket: ZilaClient, cookies: Record<string, string>) {
    socket._cookies = new Map(Object.entries(cookies));
  }

  /**
   * Adds a cookie to the client's browser if it's actually running in a browser.
   * @param cookie
   */
  /* istanbul ignore next */
  public setCookie(cookie: ICookie) {
    if (!this.isBrowser) return;

    const cookieStr = Cookie.serialize(cookie.name, cookie.value, cookie);
    this.bSend("SetCookie", cookieStr);

    this._cookies.set(cookie.name, cookie.value);
  }

  /**
   * Removes a cookie from the client's browser if it's actually running in a browser.
   * @param cookieName
   */
  /* istanbul ignore next */
  public removeCookie(cookieName: string) {
    if (!this.isBrowser) return;

    this._cookies.delete(cookieName);
    this.bSend("DelCookie", cookieName);
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
          new Promise(r => {
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
          })
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
          new Promise(r => {
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
          })
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
