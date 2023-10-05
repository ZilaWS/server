/**
 * @file ZilaWS
 * @module ZilaWs
 * @license
 * MIT License
 * Copyright (c) 2023 ZilaWS
 */

import { WebSocket as WebSocketClient } from "ws";
import { randomInt, randomUUID } from "crypto";
import { ZilaServer, WSStatus } from ".";
import { IWSMessage } from "./IWSMessage";

export default class ZilaClient {
  socket: WebSocketClient;
  id: string;
  ip: string | undefined;
  server: ZilaServer;
  status: WSStatus;

  /**
   * *You must not use this constructor!*
   *
   * Inner part of ZilaWS.
   * @param socket
   * @param ip
   * @param server
   */
  constructor(socket: WebSocketClient, ip: string | undefined, server: ZilaServer) {
    this.socket = socket;
    this.id = new Date(Date.now()).toISOString() + randomInt(0, 100);
    this.ip = ip;
    this.server = server;
    this.status = socket.readyState;
  }

  /**
   * Calls an eventhandler on the clientside for the specified client.
   * @param {string} identifier The callback's name on the clientside.
   * @param {any|undefined} data Arguments that shall be passed to the callback as parameters (optional)
   */
  public send(identifier: string, ...data: any[]) {
    if (typeof data == "function" || data.filter((el) => typeof el == "function").length > 0) {
      throw new Error("Passing functions to the server is prohibited.");
    }

    const msg: IWSMessage = {
      callbackId: null,
      message: data,
      identifier: identifier,
    };

    this.socket.send(JSON.stringify(msg));
  }

  /**
   * Calls an eventhandler on the clientside for the specified client. Gets a value of T type back from the client or just waits for the eventhandler to finish.
   * @param {string} identifier The callback's name on the clientside.
   * @param {any|undefined} data Arguments that shall be passed to the callback as parameters (optional)
   * @returns {Promise<unknown>}
   */
  public waiter(identifier: string, ...data: any[]): Promise<unknown> {
    return new Promise((resolve) => {
      if (typeof data == "function" || data.filter((el) => typeof el == "function").length > 0) {
        throw new Error("Passing functions to the client is prohibited.");
      }

      const uuid = randomUUID();

      this.setMessageHandler(uuid, (args: any[]): void => {
        this.removeMessageHandler(uuid);
        resolve(args);
      });

      const msg: IWSMessage = {
        callbackId: uuid,
        message: data,
        identifier: identifier,
      };

      this.socket.send(JSON.stringify(msg));
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
