import { ZilaServer, ZilaClient, CloseCodes, WSStatus, WebSocketClient, IncomingHttpHeaders } from "../src/index";
import { ZilaConnection } from "zilaws-client";
import { SimpleLogger, VerboseLogger } from "../src/verboseLogger";
import { join } from "path";
import { WebSocket } from "ws";
import { beforeAll, describe, expect, test, afterAll } from "@jest/globals";

class MyClient extends ZilaClient {
  public clientData: {
    rank: "admin" | "user";
    username: string;
  };

  constructor(
    socket: WebSocketClient,
    ip: string | undefined,
    server: ZilaServer,
    isBrowser: boolean,
    headers: IncomingHttpHeaders,
    cookies?: Map<string, string>
  ) {
    super(socket, ip, server, isBrowser, headers, cookies);
    this.clientData = {
      rank: "admin",
      username: "SomeUsername",
    };
  }
}

describe("Non-Secure", () => {
  let server: ZilaServer<MyClient>;
  let sharedWaiterClient: ZilaConnection;
  let sharedWaiterServerClient: ZilaClient;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  beforeAll(async () => {
    server = new ZilaServer<MyClient>({
      port: 6589,
      logger: true,
      verbose: true,
      maxWaiterTime: 800,
      clientClass: MyClient,
    });

    const pair = await connectClientPair();
    sharedWaiterClient = pair.client;
    sharedWaiterServerClient = pair.serverClient;

    server.setMessageHandler("serverSample", async (_socket, text: string) => {
      return text + " success";
    });

    sharedWaiterClient.setMessageHandler("clientSample", (gotValue: string) => {
      return gotValue + " success";
    });

    sharedWaiterClient.setMessageHandler("This event exists", (data) => {
      return data + "!";
    });

    sharedWaiterClient.setMessageHandler("BroadcastWaiter", () => {
      return "Data1";
    });

    sharedWaiterClient.setMessageHandler("BroadcastWaiterTimeout", () => {
      return "Data1";
    });
  });

  const connectClientPair = async () => {
    const existingClients = new Set(server.clients);

    const client = await ZilaConnection.connectTo("ws://127.0.0.1:6589", (reason?: string) => {
      console.error("ZilaConnection error happened:\n" + reason);
    });

    if (client.status !== WSStatus.OPEN) {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Timed out waiting for client connection to open."));
        }, 2000);

        client.addEventListener("onStatusChange", (status: WSStatus) => {
          if (status === WSStatus.OPEN) {
            clearTimeout(timeout);
            resolve();
          }
        });
      });
    }

    let serverClient: ZilaClient | undefined;
    for (let i = 0; i < 100; i++) {
      const found = server.clients.find((c) => !existingClients.has(c));
      if (found) {
        serverClient = found;
        break;
      }
      await new Promise((r) => setTimeout(r, 10));
    }

    if (!serverClient) {
      throw new Error("Unable to resolve newly connected server-side client instance.");
    }

    // Give both runtimes one tick so message handlers are ready on fresh sockets.
    await sleep(10);
    return { client, serverClient };
  };

  const disconnectClient = async (client: ZilaConnection) => {
    if (client.status !== WSStatus.CLOSED) {
      client.disconnect();
      await sleep(20);
    }
  };

  const ensureSharedWaiterPair = async () => {
    if (!sharedWaiterClient || sharedWaiterClient.status !== WSStatus.OPEN) {
      const pair = await connectClientPair();
      sharedWaiterClient = pair.client;
      sharedWaiterServerClient = pair.serverClient;
    }
  };

  test("Loggers", () => {
    VerboseLogger.error("Error");
    VerboseLogger.log("Log");
    VerboseLogger.warn("Warn");

    SimpleLogger.error("Error");
    SimpleLogger.log("Log");
    SimpleLogger.warn("Warn");
  });

  test("Remove Non-existent EventListener", () => {
    server.removeEventListener("onClientConnect", loc);
  });

  function connectedEvent(socket: ZilaClient) {
    console.info("Client Connected");
  }

  test("OnClientConnectEvent", () => {
    server.addEventListener("onClientConnect", connectedEvent);
  });

  test("Remove Non-existent EventListener when there is another listener", () => {
    server.removeEventListener("onClientConnect", loc);
  });

  test("Remove last EventListener", () => {
    server.removeEventListener("onClientConnect", connectedEvent);
  });

  test("OnRawMessage", () => {
    server.addEventListener("onClientRawMessageBeforeCallback", (socket, rawmsg) => {
      console.log(rawmsg);
    });
  });

  test("OnMessageBeforeCallback", () => {
    server.addEventListener("onClientMessageBeforeCallback", (socket, msg) => {
      console.log(msg);
    });
  });

  test("OnDisconnect", () => {
    server.onceEventListener("onClientDisconnect", (socket, code, reason) => {
      console.log(`A client has disconnected. Code: ${code} | Reason: ${reason}`);
    });
  });

  test("OnceEventListener", () => {
    server.onceEventListener("onClientConnect", (socket) => {
      console.log(socket.socket.readyState);
    });
  });

  test("Connecting to the server", async () => {
    expect(sharedWaiterClient.status).toBe(WSStatus.OPEN);
  });

  test("Client Async waiter", async () => {
    await ensureSharedWaiterPair();

    await expect(sharedWaiterClient.waiter("serverSample", "serverSampleText")).resolves.toEqual(
      "serverSampleText success"
    );
  });

  test("Server Async Waiter", async () => {
    await ensureSharedWaiterPair();

    await expect(server.waiter<string>(sharedWaiterServerClient, "clientSample", "sampleText")).resolves.toEqual(
      "sampleText success"
    );
  });

  test("Initial cookies parsed from upgrade only", async () => {
    const { client, serverClient } = await connectClientPair();
    const initial = Array.from(serverClient.cookies.entries());
    client.send("SyncCookies", "foo=bar");
    await new Promise((r) => setTimeout(r, 50));
    expect(Array.from(serverClient.cookies.entries())).toEqual(initial);
    await disconnectClient(client);
  });

  test("Cookie sync endpoint adds new cookies and does not override existing ones", async () => {
    const { client, serverClient } = await connectClientPair();
    // Establish a server-side cookie first through direct server mutation (simulating earlier state)
    serverClient.cookies.set("serverOnly", "persist");
    const first = await fetch("http://127.0.0.1:6589/zilaws/cookieSync", {
      method: "GET",
      headers: { Cookie: "testcookie=abc123; another=value" },
    });
    expect(first.status).toBe(200);
    await new Promise((r) => setTimeout(r, 30));
    expect(serverClient.cookies.get("testcookie")).toBe("abc123");
    expect(serverClient.cookies.get("another")).toBe("value");
    expect(serverClient.cookies.get("serverOnly")).toBe("persist");

    // Second sync tries to override serverOnly cookie with different value
    const second = await fetch("http://127.0.0.1:6589/zilaws/cookieSync", {
      method: "GET",
      headers: { Cookie: "serverOnly=attemptOverride; newclient=xyz" },
    });
    expect(second.status).toBe(200);
    // Collect Set-Cookie headers returned (if any)
    const setCookieHeaders = second.headers.getSetCookie
      ? second.headers.getSetCookie()
      : (second.headers as any)["set-cookie"];
    // Wait for processing
    await new Promise((r) => setTimeout(r, 30));
    // serverOnly must remain original
    expect(serverClient.cookies.get("serverOnly")).toBe("persist");
    // newclient should be added
    expect(serverClient.cookies.get("newclient")).toBe("xyz");
    // Ensure override attempt did not succeed
    expect(serverClient.cookies.get("serverOnly")).not.toBe("attemptOverride");

    await disconnectClient(client);
  });

  test("Late HttpOnly server cookie is delivered through cookieSync", async () => {
    const { client, serverClient } = await connectClientPair();

    server.setClientCookie(serverClient, {
      name: "lateHttpOnly",
      value: "secret-value",
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });

    const firstSync = await fetch("http://127.0.0.1:6589/zilaws/cookieSync", {
      method: "GET",
    });
    expect(firstSync.status).toBe(200);

    const firstSetCookies = firstSync.headers.getSetCookie
      ? firstSync.headers.getSetCookie()
      : [firstSync.headers.get("set-cookie")].filter(Boolean);

    expect(firstSetCookies.join("; ")).toContain("lateHttpOnly=secret-value");
    expect(firstSetCookies.join("; ").toLowerCase()).toContain("httponly");
    expect(firstSetCookies.join("; ").toLowerCase()).toContain("samesite=lax");
    expect(firstSetCookies.join("; ")).toContain("Path=/");

    const secondSync = await fetch("http://127.0.0.1:6589/zilaws/cookieSync", {
      method: "GET",
      headers: { Cookie: "lateHttpOnly=secret-value" },
    });
    expect(secondSync.status).toBe(200);

    const secondSetCookies = secondSync.headers.getSetCookie
      ? secondSync.headers.getSetCookie()
      : [secondSync.headers.get("set-cookie")].filter(Boolean);

    expect(secondSetCookies.join("; ")).not.toContain("lateHttpOnly=secret-value");

    await disconnectClient(client);
  });

  test("Cookie sync is isolated by zilaSession token", async () => {
    const wsA = new WebSocket("ws://127.0.0.1:6589", {
      headers: { Cookie: "zilaSession=sessA" },
    });
    const wsB = new WebSocket("ws://127.0.0.1:6589", {
      headers: { Cookie: "zilaSession=sessB" },
    });

    await Promise.all([
      new Promise<void>((resolve, reject) => {
        wsA.on("open", () => resolve());
        wsA.on("error", reject);
      }),
      new Promise<void>((resolve, reject) => {
        wsB.on("open", () => resolve());
        wsB.on("error", reject);
      }),
    ]);

    await new Promise((r) => setTimeout(r, 30));

    const sessionAClient = server.clients.find((c) => c.cookies.get("zilaSession") === "sessA");
    const sessionBClient = server.clients.find((c) => c.cookies.get("zilaSession") === "sessB");

    expect(sessionAClient).toBeDefined();
    expect(sessionBClient).toBeDefined();

    const resp = await fetch("http://127.0.0.1:6589/zilaws/cookieSync", {
      method: "GET",
      headers: { Cookie: "zilaSession=sessA; scoped=1" },
    });
    expect(resp.status).toBe(200);

    await new Promise((r) => setTimeout(r, 30));

    expect(sessionAClient?.cookies.get("scoped")).toBe("1");
    expect(sessionBClient?.cookies.get("scoped")).toBe(undefined);

    await Promise.all([
      new Promise<void>((resolve) => {
        wsA.on("close", () => resolve());
        wsA.close(CloseCodes.NORMAL, "test done");
      }),
      new Promise<void>((resolve) => {
        wsB.on("close", () => resolve());
        wsB.close(CloseCodes.NORMAL, "test done");
      }),
    ]);
  });

  test("Custom WS Client data", async () => {
    const { client } = await connectClientPair();

    const gotPayload = new Promise<void>((resolve) => {
      server.onceMessageHandler("DataCheck", (socket) => {
        expect(socket.clientData).toEqual({
          rank: "admin",
          username: "SomeUsername",
        });
        resolve();
      });
    });

    client.send("DataCheck", 123);
    await gotPayload;
    await disconnectClient(client);
  });

  test("Waiter not responding in time", async () => {
    await ensureSharedWaiterPair();

    await expect(
      server.waiter<WSStatus[]>(sharedWaiterServerClient, "This event id does not exist on the client")
    ).resolves.toBe(undefined);
  }, 1200);

  test("WaiterTimeout not responding in time", async () => {
    await ensureSharedWaiterPair();

    await expect(
      server.waiterTimeout<WSStatus[]>(sharedWaiterServerClient, "This event id does not exist on the client", 300)
    ).resolves.toBe(undefined);
  }, 400);

  test("WaiterTimeout responding in time", async () => {
    await ensureSharedWaiterPair();

    await expect(
      server.waiterTimeout<WSStatus[]>(sharedWaiterServerClient, "This event exists", 300, "Some data")
    ).resolves.toBe("Some data!");
  }, 400);

  test("Broadcast Waiter", async () => {
    await ensureSharedWaiterPair();

    const locClient = await ZilaConnection.connectTo("ws://127.0.0.1:6589", (reason?: string) => {
      console.error("ZilaConnection error happened:\n" + reason);
    });

    locClient.setMessageHandler("BroadcastWaiter", (data: string) => {
      return "Data2";
    });

    const locClient2 = await ZilaConnection.connectTo("ws://127.0.0.1:6589", (reason?: string) => {
      console.error("ZilaConnection error happened:\n" + reason);
    });

    const locClient3 = await ZilaConnection.connectTo("ws://127.0.0.1:6589", (reason?: string) => {
      console.error("ZilaConnection error happened:\n" + reason);
    });

    const resp = await server.broadcastWaiter<string>("BroadcastWaiter", "Broadcast data");
    locClient.disconnect();
    locClient2.disconnect();
    locClient3.disconnect();

    expect(resp).toContain("Data1");
    expect(resp).toContain("Data2");
  });

  test("Broadcast Waiter with timeout responding in time", async () => {
    await ensureSharedWaiterPair();

    const locClient = await ZilaConnection.connectTo("ws://127.0.0.1:6589", (reason?: string) => {
      console.error("ZilaConnection error happened:\n" + reason);
    });

    const locClient2 = await ZilaConnection.connectTo("ws://127.0.0.1:6589", (reason?: string) => {
      console.error("ZilaConnection error happened:\n" + reason);
    });

    locClient.setMessageHandler("BroadcastWaiterTimeout", async (data: string) => {
      return await new Promise((res) => {
        res("Data2");
      });
    });

    const resp = await server.broadcastWaiterTimeout<string>("BroadcastWaiterTimeout", 50, "Broadcast data");
    locClient.disconnect();
    locClient2.disconnect();

    expect(resp).toContain("Data1");
    expect(resp).toContain("Data2");
  });

  test("Broadcast Waiter with timeout not responding in time", async () => {
    await ensureSharedWaiterPair();

    const resp = await server.broadcastWaiterTimeout<string>("NonExistentIdentifier", 50, "Broadcast data");
    const testArray: any[] = [];

    for (let i = 0; i < server.clients.length; i++) {
      testArray.push(undefined);
    }

    expect(resp).toEqual(testArray);
  });

  test("Broadcast Send", async () => {
    await ensureSharedWaiterPair();

    sharedWaiterClient.onceMessageHandler("Broadcast", (data: string) => {
      expect(data).toBe("Broadcast data");
    });

    const locClient = await ZilaConnection.connectTo("ws://127.0.0.1:6589", (reason?: string) => {
      console.error("ZilaConnection error happened:\n" + reason);
    });

    locClient.onceMessageHandler("Broadcast", (data: string) => {
      expect(data).toBe("Broadcast data");
      locClient.disconnect();
    });

    server.broadcastSend("Broadcast", "Broadcast data");
  });

  test("OnceMessageHandler", async () => {
    await ensureSharedWaiterPair();

    sharedWaiterServerClient.onceMessageHandler("ONCEHANDLER", (arg1: number) => {
      arg1++;
      return arg1;
    });

    await expect(sharedWaiterClient.waiter("ONCEHANDLER", 25.474852784587654)).resolves.toBe(26.474852784587654);
  });

  test("Get all clients", async () => {
    const { client, serverClient } = await connectClientPair();
    expect(server.clients.includes(serverClient)).toBe(true);
    await disconnectClient(client);
  });

  test("Server error log", () => {
    server.serverWrapper.emit("error", new Error("Example error"));
  });

  test("Server's client socket error log", async () => {
    const { client, serverClient } = await connectClientPair();
    serverClient.socket.emit("error", new Error("Example client error"));
    await disconnectClient(client);
  });

  function loc(...args: any[]) {}

  test.failing("Multiple added event listeners", () => {
    server.addEventListener("onClientConnect", loc);
    server.addEventListener("onClientConnect", loc);
  });

  test("Remove EventListener", () => {
    server.removeEventListener("onClientConnect", loc);
  });

  test("CallEventHandler Bad Message", async () => {
    const locClient = new WebSocket("ws://127.0.0.1:6589");
    await new Promise<void>((resolve) => {
      locClient.onopen = async () => {
        locClient.send("BADMESSAGE");
        locClient.close(CloseCodes.NORMAL);
        locClient.onclose = () => {
          resolve();
        };
      };
    });

    locClient.onerror = (ev) => {
      throw ev.error;
    };
  });

  afterAll(async () => {
    await disconnectClient(sharedWaiterClient);
    await server.stopServerAsync();
  });
});

describe("Simple Server Stop", () => {
  let server: ZilaServer;

  beforeAll(async () => {
    server = new ZilaServer({
      port: 6590,
      logger: true,
      verbose: true,
      maxWaiterTime: 4000,
    });
  });

  test("Server Stop", () => {
    server.stopServer();
  });
});

describe("Server Stop", () => {
  let server: ZilaServer;

  beforeAll(async () => {
    server = new ZilaServer({
      port: 6591,
      logger: true,
      verbose: false,
    });
  });

  test("Double Server Stop Async ", async () => {
    const clients = new Array(12).map(async (el) => await ZilaConnection.connectTo("ws://127.0.0.1:6591"));

    await server.stopServerAsync();
    await expect(server.stopServerAsync()).rejects.toThrow("The server is not running");
  });
});

describe("Connection closing", () => {
  let server: ZilaServer;

  beforeAll(async () => {
    server = new ZilaServer({
      port: 6592,
      logger: true,
      verbose: false,
    });
  });

  test("Disconnected SimpleLog", async () => {
    const locClient = await ZilaConnection.connectTo("ws://127.0.0.1:6592", (reason?: string) => {
      console.error("ZilaConnection error happened:\n" + reason);
    });

    await locClient.disconnectAsync();
  });

  test("Kick", async () => {
    await new Promise<void>(async (resolve) => {
      const locClient = await ZilaConnection.connectTo("ws://127.0.0.1:6592");
      server.onceMessageHandler("TOBEKICKED", async (socket) => {
        socket.kick();
      });

      locClient.addEventListener("onStatusChange", () => {
        resolve();
      });

      locClient.send("TOBEKICKED");
    });
  });

  test("Ban", async () => {
    await new Promise<void>(async (resolve) => {
      const locClient = await ZilaConnection.connectTo("ws://127.0.0.1:6592", async (reason?: string) => {
        expect(reason).toEqual("A reason to ban");
        const retry = await ZilaConnection.connectTo("ws://127.0.0.1:6592", (reason?: string) => {
          expect(reason).toEqual("A reason to ban");
          resolve();
        });
      });

      server.onceMessageHandler("BANME", async (socket) => {
        socket.ban("A reason to ban");
      });

      locClient.send("BANME");
    });
  });

  test("Client is banned", async () => {
    const locClient = await ZilaConnection.connectTo("ws://127.0.0.1:6592");
    locClient.addEventListener("onStatusChange", (val: WSStatus) => {
      expect(val).toBe(WSStatus.CLOSED);
    });
  });

  afterAll(async () => {
    await server.stopServerAsync();
  });
});

describe("Connection closing", () => {
  let server: ZilaServer;

  beforeAll(async () => {
    server = new ZilaServer({
      port: 6593,
      logger: true,
      verbose: false,
    });
  });

  test("Disconnected SimpleLog", async () => {
    const locClient = await ZilaConnection.connectTo("ws://127.0.0.1:6593", (reason?: string) => {
      console.error("ZilaConnection error happened:\n" + reason);
    });

    await expect(locClient.disconnectAsync()).resolves.toBe(undefined);
  });

  afterAll(async () => {
    await server.stopServerAsync();
  });
});

describe("Secure Server connecting", () => {
  let client: ZilaConnection;
  let server: ZilaServer;

  beforeAll(async () => {
    server = new ZilaServer({
      port: 6594,
      logger: true,
      verbose: true,
      https: {
        pathToCert: join(__dirname, "cert/cert.pem"),
        pathToKey: join(__dirname, "cert/key.pem"),
        passphrase: "asdASD123",
        allowSelfSigned: true,
      },
    });
  });

  test("Connecting", async () => {
    client = await ZilaConnection.connectTo(
      "wss://127.0.0.1:6594",
      (reason?: string) => {
        console.error(reason);
      },
      true
    );
    expect(client.status).toBe(WSStatus.OPEN);
  });

  afterAll(async () => {
    await server.stopServerAsync();
  });
});

describe("Secure Server Connecting", () => {
  let client: ZilaConnection;
  let server: ZilaServer;

  beforeAll(async () => {
    server = new ZilaServer({
      port: 6596,
      logger: true,
      verbose: true,
      https: {
        pathToCert: join(__dirname, "cert/cert.pem"),
        pathToKey: join(__dirname, "cert/key.pem"),
        passphrase: "asdASD123",
        allowSelfSigned: true,
      },
    });
  });

  test("Server status getter", () => {
    expect(server.status).toBe(WSStatus.OPEN);
  });

  test("Disconnecting", async () => {
    client = await ZilaConnection.connectTo(
      "wss://127.0.0.1:6596",
      (reason?: string) => {
        console.error(reason);
      },
      true
    );
    await expect(client.disconnectAsync()).resolves.toBe(undefined);
  });

  afterAll(async () => {
    await server.stopServerAsync();
  });
});

describe("Custom Header server", () => {
  let client: ZilaConnection;
  let server: ZilaServer;

  beforeAll(async () => {
    server = new ZilaServer({
      port: 6595,
      headerEvent(headers) {
        if (headers.authorization) {
          console.log(headers.authorization);
        }
        return ["authorization: Bearer myBearerToken"];
      },
    });
  });

  test("Connecting", async () => {
    client = await ZilaConnection.connectTo(
      "ws://127.0.0.1:6595",
      (reason?: string) => {
        console.error(reason);
      },
      true
    );
    expect(client.status).toBe(WSStatus.OPEN);
  });

  test("Server status getter", () => {
    expect(server.status).toBe(WSStatus.OPEN);
  });

  test("Disconnecting", async () => {
    await expect(client.disconnectAsync()).resolves.toBe(undefined);
  });

  afterAll(async () => {
    await server.stopServerAsync();
  });
});
