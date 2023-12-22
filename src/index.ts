/**
 * @file ZilaWS
 * @module ZilaWS
 * @license
 * MIT License
 * Copyright (c) 2023 ZilaWS
 */
import { WebSocketServer } from "ws";
import { readFileSync } from "fs";
import { createServer as createServerHTTP, type Server as ServerHTTP } from "http";
import { createServer as createServerHTTPS, type Server as ServerHTTPS } from "https";
import { IncomingMessage, IncomingHttpHeaders } from "http";
import { ILogger, VerboseLogger, SimpleLogger } from "./verboseLogger";
import ZilaClient from "./ZilaClient";
import { CloseCodes, WSStatus } from "./enums";
import { IWSMessage } from "./IWSMessage";
import { ZilaWSCallback } from "./ZilaWSCallback";
import { parse as parseCookie } from "cookie";

interface IServerSettings {
  /**
   * The port of the WebSocket server
   */
  port: number;
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
  };
  /**
   * Enables verbose logging
   */
  verbose?: boolean;
  /**
   * By giving this property an ILogger interface, you can create your own logger script.
   * If you give it true, the default logging script will be used.
   */
  logger?: boolean | ILogger;
  /**
   * Sets the host for the server
   */
  host?: string;

  /**
   * This event handler gets called before a new WS connection would be created.
   * If you want to add new headers to the ugprade frame's reponse, return them as an array.
   * @returns {Array<string>}
   */
  headerEvent?: (recievedHeaders: IncomingHttpHeaders) => Array<string> | void;
}

interface IServerEvents {
  /**
   * Runs every time a client connects.
   * @param socket
   * @param req
   * @returns
   */
  onClientConnect: (socket: ZilaClient) => void;

  /**
   * Runs every time a client disconnects
   * @param socket
   * @param code
   * @param reason
   * @returns
   */
  onClientDisconnect: (socket: ZilaClient, code: number, reason: string) => void;

  /**
   * Runs every time after a the server processes a message from the client.
   * @param socket
   * @param eventHandlerName The name of the event handler callback
   * @param message If the message object is instance of T, this param will be T, undefined if not.
   * @returns
   */
  onClientMessage: <T>(socket: ZilaClient, eventHandlerName: string, messageDataObject: T | undefined) => void;

  /**
   * Runs every time a server recieves a message from the client before any registered callback could run
   * @param socket
   * @param eventHandlerName The name of the event handler callback
   * @param message If the message object is instance of T, this param will be T, undefined if not.
   * @returns
   */
  onClientMessageBeforeCallback: <T>(
    socket: ZilaClient,
    eventHandlerName: string,
    messageDataObject: T | undefined
  ) => void;

  /**
   * Runs every time a server recieves a message from the client before any registered callback could run.
   * @param socket
   * @param rawMessage Not processed, raw message from the client. (Hopefully JSON)
   * @returns
   */
  onClientRawMessageBeforeCallback: (socket: ZilaClient, rawMessage: string) => void;
}

export class ZilaServer {
  wss: WebSocketServer;
  VerbLog?: ILogger;
  Logger?: ILogger;

  private hasrequested: boolean;

  private baseServer: ServerHTTP | ServerHTTPS;

  private serverEvents: {
    [K in keyof IServerEvents]?: Array<IServerEvents[K]> | undefined;
  } = {};

  private readonly callbacks: { [id: string]: ZilaWSCallback | undefined } = {};

  private readonly bannedIpsAndReasons: Map<string, string | undefined> = new Map();

  private _status: WSStatus = WSStatus.OPENING;

  private headerEvent: ((recievedHeaders: IncomingHttpHeaders) => Array<string> | void) | undefined = undefined;

  public get status() {
    return this._status;
  }

  private _clients: Set<ZilaClient> = new Set();

  public get clients() {
    return this._clients;
  }

  public readonly settings: IServerSettings;

  public constructor(settings: IServerSettings) {
    this.settings = settings;
    this.hasrequested = false;

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

    this.wss = new WebSocketServer({
      noServer: true,
    });

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
      if (!req.socket.remoteAddress) return;
      this.hasrequested = true;

      const [_, reason] = this.bannedIpsAndReasons.get(req.socket.remoteAddress) ?? [undefined, undefined];

      if (!reason) return;

      res.writeHead(403, reason);
      res.end();
    });

    this.baseServer.on("upgrade", (req, socket, head) => {
      //Can't test this with Node.
      /* istanbul ignore next */
      if (req.headers["set-cookie"] != undefined && req.headers["s-type"] == "1") {
        //The s-type indicates this client is not running in a browser but the set-cookie means it has cookies. This might pose as a security threat, automatically closing the connection.
        this.Logger?.warn(
          `A client with the IP address of ${req.socket.remoteAddress} tried to connect while having cookies in its header and a marking for non-browser environment.`
        );

        socket.write(`HTTP/1.1 403 Forbidden\r\n`);
        socket.write(`Content-Type: text/plain\r\n`);
        socket.end();
        return;
      }

      this.wss.handleUpgrade(req, socket, head, (client, uReq) => {
        this.wss.emit("connection", client, uReq);
      });
    });

    this.headerEvent = settings.headerEvent;

    if (this.headerEvent !== undefined) {
      const hde = this.headerEvent;
      this.wss.on("headers", (headers, request) => {
        const retValues = hde(request.headers);
        if (typeof retValues == "object") headers.push(...retValues);
      });
    }

    this._status = WSStatus.OPEN;

    this.Logger?.log(
      `Ready for incoming connections on port ${settings.port} with SSL ${
        settings.https ? "enabled" : "disabled"
      }.`
    );

    this.wss.addListener("close", () => {
      this._status = WSStatus.CLOSED;
      this.Logger?.log("The server has closed.");
    });

    this.wss.addListener("error", (err) => {
      this.Logger?.error(`An error has occured: ${err.stack}`);
    });

    this.wss.addListener("connection", (socket, req) => {
      if (!this.hasrequested) {
        const reason = this.bannedIpsAndReasons.get(req.socket.remoteAddress!);

        if (reason) {
          socket.close(CloseCodes.BANNED, reason);
        }
      }

      this.Logger?.log(`A client has connected: ${getIPAndPort(req)}`);

      const zilaSocket = new ZilaClient(
        socket,
        req.socket.remoteAddress,
        this,
        req.headers["s-type"] != "1",
        //Can't test this with Node.
        /* istanbul ignore next */
        req.headers.cookie ? new Map(Object.entries(parseCookie(req.headers.cookie))) : new Map()
      );

      this._clients.add(zilaSocket);

      if (this.serverEvents.onClientConnect) {
        for (const cb of this.serverEvents.onClientConnect) {
          cb(zilaSocket);
        }
      }

      zilaSocket.socket.addListener("message", (data) => {
        const datastring = data.toString();
        if (this.serverEvents.onClientRawMessageBeforeCallback) {
          for (const cb of this.serverEvents.onClientRawMessageBeforeCallback) {
            cb(zilaSocket, datastring);
          }
        }

        this.VerbLog?.log(`Message recieved: ${getIPAndPort(req)}\nData:${datastring}`);
        this.callMessageHandler(zilaSocket, req, datastring);
      });

      zilaSocket.socket.addEventListener("close", (event) => {
        if (this.serverEvents.onClientDisconnect) {
          for (const cb of this.serverEvents.onClientDisconnect) {
            cb(zilaSocket, event.code, event.reason);
          }
        }

        if (this.VerbLog) {
          this.VerbLog.log(
            `A client has been disconnected. IP: ${getIPAndPort(req)} | Code: ${event.code} | Type: ${
              event.type
            } | wasClean: ${event.wasClean}`
          );
        } else if (this.Logger) {
          this.Logger.log(`A client has been disconnected. IP: ${getIPAndPort(req)}`);
        }
      });

      if (this.VerbLog) {
        zilaSocket.socket.addEventListener("error", (event) => {
          this.VerbLog?.error(
            `An error has occured: IP: ${getIPAndPort(req)} | Message: ${event.message}\n${event.error}`
          );
        });
      }
    });
  }

  /**
   * Creates a new event listener that runs every time an event occurs which it got registered to.
   * @param eventType
   * @param callback
   */
  public addEventListener<K extends keyof IServerEvents>(eventType: K, callback: IServerEvents[K]) {
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
  public removeEventListener<K extends keyof IServerEvents>(eventType: K, callback: IServerEvents[K]) {
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
  public onceEventListener<K extends keyof IServerEvents>(eventType: K, callback: IServerEvents[K]) {
    const that = this;

    function onceCallback(...args: any[]) {
      that.removeEventListener(eventType, onceCallback);
      (callback as Function)(...args);
    }

    this.addEventListener(eventType, onceCallback);
  }

  /**
   * Calls an eventhandler on the clientside for the specified client.
   * @param {ZilaClient} socket The websocket client
   * @param {string} identifier The callback's name on the clientside.
   * @param {any|undefined} data Arguments that shall be passed to the callback as parameters (optional)
   */
  public send(socket: ZilaClient, identifier: string, ...data: any[]): void {
    socket.send(identifier, ...data);
  }

  public broadcastSend(identifier: string, ...data: any[]): void {
    for (const socket of this.wss.clients) {
      const msg: IWSMessage = {
        callbackId: null,
        message: data,
        identifier: identifier,
      };

      socket.send(JSON.stringify(msg));
    }
  }

  /**
   * Calls an eventhandler on the clientside for the specified client. Gets a value of T type back from the client or just waits for the eventhandler to finish.
   * @param {ZilaClient} socket The websocket client
   * @param {string} identifier The callback's name on the clientside.
   * @param {any|undefined} data Arguments that shall be passed to the callback as parameters (optional)
   * @returns {Promise<unknown>}
   */
  public waiter(socket: ZilaClient, identifier: string, ...data: any[]): Promise<unknown> {
    return socket.waiter(identifier, ...data);
  }

  public broadcastWaiter(identifier: string, maxWaitTime: number, ...data: any[]): Array<Promise<unknown>> {
    const promises: Array<Promise<unknown>> = [];

    for (const socket of this._clients) {
      promises.push(
        Promise.race([socket.waiter(identifier, ...data), new Promise((_r, rej) => setTimeout(rej, maxWaitTime))])
      );
    }

    return promises;
  }

  /**
   * Registers an eventhandler.
   * The registered callback will run when one of the clients ask for it with the given identifier.
   * Can get overrided with using the same identifier.
   * @param identifier The eventhandler's name
   * @param callback The eventhandler
   */
  public setMessageHandler(identifier: string, callback: ZilaWSCallback): void {
    this.callbacks[identifier] = callback;
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
  public onceMessageHandler(identifier: string, callback: ZilaWSCallback): void {
    this.callbacks[identifier] = (socket, ...args: any[]) => {
      this.removeMessageHandler(identifier);
      return callback(socket, ...args);
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
   */
  public stopServer() {
    this.wss.close();
    this.baseServer.close();
  }

  /**
   * Stops the ZilaWS server asynchronously
   * @param reason This reason'll be sent down to all the clients.
   * @returns {Promise<void>}
   */
  public stopServerAsync(reason?: string): Promise<void> {
    return new Promise(async (resolve, reject) => {
      await Promise.allSettled(
        [...this.wss.clients].map(async (client) => {
          return new Promise<void>((res) => {
            client.addEventListener("close", (ev) => {
              res();
            });
            client.close(CloseCodes.NORMAL, reason);
          });
        })
      );

      this.wss.options.server?.close(); //Re-add error logging if needed.

      this.wss.close((err) => {
        if (err) {
          reject(err.message);
        } else {
          this.baseServer.close((bError) => {
            //This can't be tested without setting the baseServer property to public.
            /* istanbul ignore next */
            if (bError) {
              reject(bError.message);
            } else {
              resolve();
            }
          });
        }
      });
    });
  }

  /**
   * Calls the given callback if the client recieves a request for it from the server.
   * @param {string} msg The raw websocket message
   */
  private async callMessageHandler(socket: ZilaClient, req: IncomingMessage, msg: string) {
    let msgObj: IWSMessage;
    new Promise<IWSMessage>((resolve) => {
      let loc: IWSMessage;
      try {
        loc = JSON.parse(msg) as IWSMessage;
        resolve(loc);
      } catch {
        this.Logger?.warn(`Bad Message from ${getIPAndPort(req)}`);
      }
    }).then((val) => {
      msgObj = val;

      /* istanbul ignore next */
      if (msgObj.identifier[0] != "@") {
        //Inner event
        if (msgObj.identifier == "SyncCookies") {
          if (
            msgObj.message !== undefined &&
            msgObj.message !== null &&
            typeof msgObj.message == "object" &&
            Object.hasOwn(msgObj.message, "length")
          ) {
            try {
              ZilaClient.StoreSyncedCookies(socket, parseCookie(msgObj.message));
            } catch {
              this.Logger?.warn(`Bad Message from ${getIPAndPort(req)}`);
            }
          }
        }

        return;
      }

      msgObj.identifier = msgObj.identifier.slice(1);

      if (this.serverEvents.onClientRawMessageBeforeCallback) {
        for (const cb of this.serverEvents.onClientRawMessageBeforeCallback) {
          cb(socket, msg);
        }
      }

      if (this.serverEvents.onClientMessageBeforeCallback) {
        for (const cb of this.serverEvents.onClientMessageBeforeCallback) {
          cb(socket, msgObj.identifier, msgObj.message);
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

/**
 * Returns a formatted string of the IP and the port of the given req.
 * @example `127.0.0.1:4789`
 * @param {IncomingMessage} req
 * @returns
 */
function getIPAndPort(req: IncomingMessage): string {
  return `${req.socket.remoteAddress}:${req.socket.remotePort}`;
}

export { ZilaClient, CloseCodes, WSStatus };
