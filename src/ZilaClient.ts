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
import { IWSMessage } from "./IWSMessage";
import Cookie from "cookie";
import { ICookie } from "./ICookie";

export default class ZilaClient {
  socket: WebSocketClient;
  id: string;
  ip: string | undefined;
  server: ZilaServer;
  status: WSStatus;
  isBrowser: boolean;

  private _cookies: Record<string, string> = {};

  /**
   * Cookies of the client's browser.
   * Only contains cookies which were present while estabilishing the connection and which were set by ZilaWS.
   */
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
    cookies?: Record<string, string>
  ) {
    this.socket = socket;
    this.id = new Date(Date.now()).toISOString() + randomInt(0, 100);
    this.ip = ip;
    this.server = server;
    this.status = socket.readyState;
    if (cookies) this._cookies = cookies;
    this.isBrowser = isBrowser;
  }

  public setCookie(cookie: ICookie) {
    const cookieStr = Cookie.serialize(cookie.name, cookie.value, cookie);
    this.bSend("SetCookie", cookieStr);
    this._cookies[cookie.name] = cookie.value;
  }

  public removeCookie(cookieName: string) {
    if (Object.hasOwn(this._cookies, cookieName)) {
      delete this._cookies[cookieName];
    }

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
    return JSON.stringify({
      identifier: isBuiltIn ? "@" + identifier : identifier,
      message: data,
      callbackId: callbackId,
    });
  }

  /**
   * Calls an eventhandler on the clientside for the specified client.
   * @param {string} identifier The callback's name on the clientside.
   * @param {any|undefined} data Arguments that shall be passed to the callback as parameters (optional)
   */
  public send(identifier: string, ...data: any[]) {
    this.socket.send(this.getMessageJSON(identifier, data, null));
  }

  /**
   * Send function for built-in systems
   * @param {string} identifier The callback's name on the clientside.
   * @param {any|undefined} data Arguments that shall be passed to the callback as parameters (optional)
   */
  private bSend(identifier: string, ...data: any[]) {
    this.socket.send(this.getMessageJSON(identifier, data, null, true));
  }

  /**
   * Calls an eventhandler on the clientside for the specified client. Gets a value of T type back from the client or just waits for the eventhandler to finish.
   * @param {string} identifier The callback's name on the clientside.
   * @param {any|undefined} data Arguments that shall be passed to the callback as parameters (optional)
   * @returns {Promise<unknown>}
   */
  public waiter(identifier: string, ...data: any[]): Promise<unknown> {
    return new Promise((resolve) => {
      const uuid = randomUUID();

      this.setMessageHandler(uuid, (args: any[]): void => {
        this.removeMessageHandler(uuid);
        resolve(args);
      });

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
