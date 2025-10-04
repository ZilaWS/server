import { IServerSettings, WSStatus } from "..";
import IClientWrapper from "../interfaces/IClientWrapper";
import IServerWrapperEvents from "../interfaces/IServerWrapperEvents";

export default abstract class ServerWrapper {
  /**
   * Returns a set contaning all of the connected clients.
   */
  abstract get clients(): Set<IClientWrapper>;

  public readonly settings: IServerSettings;
  /**
   * Map of banned IP addresses and optional reasons.
   */
  public bannedIpsAndReasons: Map<string, string | undefined> = new Map();

  protected _status: WSStatus = WSStatus.OPENING;

  public get status(): WSStatus {
    return this._status;
  }

  constructor(settings: IServerSettings) {
    this.settings = settings;
  }

  /**
   * Injects the shared ban list map managed by ZilaServer.
   */
  public setServerWrapper(map: Map<string, string | undefined>) {
    this.bannedIpsAndReasons = map;
  }

  /**
   * Triggers an event which callbacks are subscribed to.
   *
   * Returns `true` if the event had listeners, `false` otherwise.
   * @param eventName
   * @param args
   * @returns
   */
  abstract emit<K extends keyof IServerWrapperEvents>(eventName: K, ...args: any[]): boolean;

  /**
   * Registers a new callback for an event.
   * @param events
   * @param callback
   * @returns
   */
  abstract addListener<K extends keyof IServerWrapperEvents>(events: K, callback: IServerWrapperEvents[K]): void;

  /**
   * Closes the server.
   * @param reason Reason for the closure.
   * @returns
   */
  abstract close(reason?: string): void;

  /**
   * Closes the server and waits for it to happen.
   * @param reason Reason for the closure.
   * @returns
   */
  abstract closeAsync(reason?: string): Promise<void>;
}
