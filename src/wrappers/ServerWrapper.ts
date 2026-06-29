import { IServerSettings, WSStatus } from "..";
import IClientWrapper from "../interfaces/IClientWrapper";
import IServerWrapperEvents from "../interfaces/IServerWrapperEvents";
import { ICookie } from "../interfaces/ICookie";
import type ZilaClient from "../ZilaClient";
import { serialize as serializeCookie } from "cookie";

type SessionState = {
  cookies: Map<string, string>;
  clients: Set<ZilaClient>;
  pendingSetCookies: Map<string, string>;
};

export default abstract class ServerWrapper {
  /**
   * Returns a set contaning all of the connected clients.
   */
  public abstract get clients(): Set<IClientWrapper>;

  protected sessions: Map<string, SessionState> = new Map();
  protected clientSessionKeys: WeakMap<ZilaClient, string> = new WeakMap();

  public readonly settings: IServerSettings;
  /**
   * Map of banned IP addresses and optional reasons.
   */
  public bannedIpsAndReasons: Map<string, string | undefined> = new Map();

  protected _status: WSStatus = WSStatus.OPENING;

  protected eventListeners: Map<
    keyof IServerWrapperEvents,
    Array<NonNullable<IServerWrapperEvents[keyof IServerWrapperEvents]>>
  > = new Map();

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
   * Registers a client into a session bucket and merges initial cookie state.
   */
  public registerSessionClient(sessionKey: string, client: ZilaClient, initialCookies: Map<string, string>): void {
    let session = this.sessions.get(sessionKey);
    if (!session) {
      session = { cookies: new Map(), clients: new Set(), pendingSetCookies: new Map() };
      this.sessions.set(sessionKey, session);
    }

    session.clients.add(client);
    this.clientSessionKeys.set(client, sessionKey);

    for (const [k, v] of initialCookies.entries()) {
      if (!session.cookies.has(k)) {
        session.cookies.set(k, v);
      }
      this.ensureClientCookie(client, k, v);
    }

    // Bring the newly connected client up to the canonical session cookie set.
    for (const [k, v] of session.cookies.entries()) {
      this.ensureClientCookie(client, k, v);
    }
  }

  /**
   * Removes a client from a session bucket and prunes empty sessions.
   */
  public unregisterSessionClient(sessionKey: string, client: ZilaClient): void {
    const session = this.sessions.get(sessionKey);
    if (!session) return;

    session.clients.delete(client);
    this.clientSessionKeys.delete(client);
    if (session.clients.size === 0) {
      this.sessions.delete(sessionKey);
    }
  }

  public queueClientCookie(client: ZilaClient, cookie: ICookie): void {
    const sessionKey = this.clientSessionKeys.get(client);
    if (!sessionKey) {
      this.ensureClientCookie(client, cookie.name, cookie.value);
      client.requestCookieSync();
      return;
    }

    this.queueSessionCookie(sessionKey, cookie);
  }

  public queueSessionCookie(sessionKey: string, cookie: ICookie): void {
    let session = this.sessions.get(sessionKey);
    if (!session) {
      session = { cookies: new Map(), clients: new Set(), pendingSetCookies: new Map() };
      this.sessions.set(sessionKey, session);
    }

    session.cookies.set(cookie.name, cookie.value);
    session.pendingSetCookies.set(cookie.name, this.serializeSetCookie(cookie));

    for (const client of session.clients) {
      this.ensureClientCookie(client, cookie.name, cookie.value);
      client.requestCookieSync();
    }
  }

  /**
   * Merges cookies from /zilaws/cookieSync into a session and returns Set-Cookie headers
   * for server-side cookies missing in the provided cookie header.
   */
  public syncSessionCookies(sessionKey: string, cookies: Map<string, string>): string[] | undefined {
    const session = this.sessions.get(sessionKey);
    if (!session) return undefined;

    for (const [k, v] of cookies.entries()) {
      if (!session.cookies.has(k)) {
        session.cookies.set(k, v);
      }
    }

    for (const client of session.clients) {
      for (const [k, v] of session.cookies.entries()) {
        this.ensureClientCookie(client, k, v);
      }
    }

    const setCookieHeaders: string[] = [];

    for (const [name, header] of session.pendingSetCookies.entries()) {
      if (cookies.get(name) === session.cookies.get(name)) {
        session.pendingSetCookies.delete(name);
      } else {
        setCookieHeaders.push(header);
      }
    }

    for (const [k, v] of session.cookies.entries()) {
      if (!cookies.has(k) && !session.pendingSetCookies.has(k)) {
        setCookieHeaders.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
      }
    }

    return setCookieHeaders.length ? setCookieHeaders : undefined;
  }

  private serializeSetCookie(cookie: ICookie): string {
    return serializeCookie(cookie.name, cookie.value, {
      domain: cookie.domain,
      expires: cookie.expires,
      httpOnly: cookie.httpOnly,
      maxAge: cookie.maxAge,
      partitioned: cookie.partitioned,
      path: cookie.path,
      priority: cookie.priority,
      sameSite: cookie.sameSite,
      secure: cookie.secure,
    } as any);
  }

  private ensureClientCookie(client: ZilaClient, key: string, value: string): void {
    if (!client.cookies.has(key)) {
      (client as any)._cookies.set(key, value);
    }
  }

  /**
   * Triggers an event which callbacks are subscribed to.
   *
   * Returns `true` if the event had listeners, `false` otherwise.
   * @param eventName
   * @param args
   * @returns
   */
  public emit<K extends keyof IServerWrapperEvents>(
    eventName: K,
    ...args: Parameters<NonNullable<IServerWrapperEvents[K]>>
  ): boolean {
    const listeners = this.eventListeners.get(eventName) as
      | Array<NonNullable<IServerWrapperEvents[K]>>
      | undefined;
    if (!listeners || listeners.length === 0) {
      return false;
    }

    listeners.forEach((listener) => {
      try {
        // Use any to avoid mismatched 'this' signatures across different event callbacks
        (listener as any).apply(this, args as any);
      } catch (error) {
        console.error(`Error in event listener for ${String(eventName)}:`, error);
      }
    });

    return true;
  }
  /**
   * Registers a new callback for an event.
   * @param eventName
   * @param callback
   * @returns
   */
  public addListener<K extends keyof IServerWrapperEvents>(
    eventName: K,
    callback: NonNullable<IServerWrapperEvents[K]>
  ): void {
    const listeners =
      (this.eventListeners.get(eventName) as Array<NonNullable<IServerWrapperEvents[K]>> | undefined) ?? [];
    listeners.push(callback);
    // Cast to any because the mapped type of eventListeners varies per-key and
    // TypeScript cannot easily infer the exact function signature here.
    this.eventListeners.set(eventName, listeners as any);
  }

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
