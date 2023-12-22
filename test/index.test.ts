import { ZilaServer, ZilaClient, CloseCodes, WSStatus } from "../src/index";
import { connectTo, ZilaConnection } from "zilaws-client";
import { SimpleLogger, VerboseLogger } from "../src/verboseLogger";
import { WebSocket } from "ws";
import { join } from "path";

class MyClient extends ZilaClient {
  public clientData: {
    rank: "admin" | "user";
    username: string;
  }

  constructor(socket: WebSocket, ip: string | undefined, server: ZilaServer, isBrowser: boolean, cookies?: Map<string, string>) {
    super(socket, ip, server, isBrowser, cookies);
    
    this.clientData = {
      rank: "admin",
      username: "SomeUsername"
    }
  }
}

describe("Non-Secure", () => {
  let client: ZilaConnection;
  let server: ZilaServer<MyClient>;
  let clientSocket: ZilaClient;

  beforeAll(async () => {
    server = new ZilaServer<MyClient>({
      port: 6589,
      logger: true,
      verbose: true,
      clientClass: MyClient
    });
  });

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
    client = await connectTo("ws://127.0.0.1:6589", (reason) => {
      console.error("ZilaConnection error happened:\n" + reason);
    });

    client.setMessageHandler("clientSample", (gotValue: string) => {
      expect(gotValue).toEqual("sampleText");
      return gotValue + " success";
    });

    server.setMessageHandler("serverSample", async (socket, text: string) => {
      clientSocket = socket;
      expect(text).toEqual("serverSampleText");

      return text + " success";
    });
  });

  test("Client Async waiter", async () => {
    expect(await client.waiter("serverSample", "serverSampleText")).toEqual<string>("serverSampleText success");
  }, 15000);

  test("Server Async Waiter", async () => {
    const resp = await server.waiter(clientSocket, "clientSample", "sampleText");
    expect(resp).toEqual<string>("sampleText success");
  });

  test("Custom WS Client data", () => {
    server.onceMessageHandler("DataCheck", (socket) => {
      expect(socket.clientData).toEqual({
        rank: "admin",
        username: "SomeUsername"
      });
    });

    client.send("asd", 123);
  });

  test("Broadcast Waiter", async () => {
    client.onceMessageHandler("BroadcastWaiter", (data: string) => {
      expect(data).toBe("Broadcast data");
      return "Data1";
    });

    const locClient = await connectTo("ws://127.0.0.1:6589", (reason) => {
      console.error("ZilaConnection error happened:\n" + reason);
    });

    locClient.onceMessageHandler("BroadcastWaiter", async (data: string) => {
      expect(data).toBe("Broadcast data");
      return await new Promise((res) => {
        res("Data2");
      });
    });

    locClient.onceMessageHandler("BroadcastWaiter", (data: string) => {
      expect(data).toBe("Broadcast data");
      return "Data2";
    });

    const resp = (
      await Promise.allSettled(server.broadcastWaiter("BroadcastWaiter", 50, "Broadcast data"))
    ).filter((el) => el.status == "fulfilled");
    locClient.disconnect();

    if (resp[0].status == "fulfilled" && resp[1].status == "fulfilled") {
      expect(new Set([resp[0].value, resp[1].value])).toEqual(new Set(["Data1", "Data2"]));
    } else {
      fail("A promise was not fulfilled");
    }
  });

  test("Broadcast Send", async () => {
    client.onceMessageHandler("Broadcast", (data: string) => {
      expect(data).toBe("Broadcast data");
    });

    const locClient = await connectTo("ws://127.0.0.1:6589", (reason) => {
      console.error("ZilaConnection error happened:\n" + reason);
    });

    locClient.onceMessageHandler("Broadcast", (data: string) => {
      expect(data).toBe("Broadcast data");
      locClient.disconnect();
    });

    server.broadcastSend("Broadcast", "Broadcast data");
  });

  test("OnceMessageHandler", async () => {
    clientSocket.onceMessageHandler("ONCEHANDLER", (arg1: number) => {
      arg1++;
      expect(arg1).toEqual(26.474852784587654);
      return arg1;
    });
    expect(await client.waiter("ONCEHANDLER", 25.474852784587654)).toBe(26.474852784587654);
  });

  function loc(...args: any[]) { }

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

  test("Get all clients", () => {
    expect(server.clients.has(clientSocket)).toBe(true);
  });

  test("Server error log", () => {
    server.wss.emit("error", new Error("Example error"));
  });

  test("Server's client socket error log", () => {
    clientSocket.socket.emit("error", new Error("Example client error"));
  });

  afterAll(async () => {
    await client.disconnectAsync();
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

  test.failing("Double Server Stop Async ", async () => {
    await server.stopServerAsync();
    expect(await server.stopServerAsync()).rejects.toThrow("The server is not running");
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
    const locClient = await connectTo("ws://127.0.0.1:6592", (reason) => {
      console.error("ZilaConnection error happened:\n" + reason);
    });

    await locClient.disconnectAsync();
  });

  test("Kick", async () => {
    await new Promise<void>(async (resolve) => {
      const locClient = await connectTo("ws://127.0.0.1:6592");
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
      const locClient = await connectTo("ws://127.0.0.1:6592", async (reason) => {
        expect(reason).toEqual("A reason to ban");
        const retry = await connectTo("ws://127.0.0.1:6592", (reason) => {
          expect(reason).toEqual("A reason to ban");
        });
      });

      locClient.addEventListener("onStatusChange", (val) => {
        resolve();
      });

      server.onceMessageHandler("BANME", async (socket) => {
        socket.ban("A reason to ban");
      });

      locClient.send("BANME");
    });
  });

  test("Client is banned", async () => {
    const locClient = await connectTo("ws://127.0.0.1:6592");
    locClient.addEventListener("onStatusChange", (val) => {
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
    const locClient = await connectTo("ws://127.0.0.1:6593", (reason) => {
      console.error("ZilaConnection error happened:\n" + reason);
    });

    await expect(locClient.disconnectAsync()).resolves.toBe(undefined);
  });

  afterAll(async () => {
    await server.stopServerAsync();
  });
});

describe("Secure Server", () => {
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
      },
    });
  });

  test("Connecting", async () => {
    client = await ZilaConnection.connectTo(
      "wss://127.0.0.1:6594",
      (reason) => {
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
      (reason) => {
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