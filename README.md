# ZilaWS Server

ZilaWS is a blazingly fast and very lightweight library that provides an extremely easy-to-use way to transmit data via websockets between client-side and server-side using eventhandlers and async waiters

[![Test status badge](https://github.com/ZilaWS/server/actions/workflows/test.yml/badge.svg)](https://github.com/ZilaWS/server/actions/workflows/test.yml)
![MIT License](https://img.shields.io/badge/License%20-%20MIT%20-%20brightgreen)
![coverage label for branches](./.coverage-badges/badge-branches.svg)
![coverage label for functions](./.coverage-badges/badge-functions.svg)
![coverage label for lines of code](./.coverage-badges/badge-lines.svg)
![coverage label for statements](./.coverage-badges/badge-statements.svg)

<img src="logo.png" alt="ZilaWS Logo" width="240">

## [Documentation](https://zilaws.com)

## Looking for the [zilaws-client](https://www.npmjs.com/package/zilaws-client) package?</h2>

The ZilaWS Server can accept WS connections from non-ZilaWS clients but won't work as expected.

## Runtime support (Node.js & Bun)

Since `3.0.0` the server runs on both Node.js and Bun. The correct server implementation is selected automatically at runtime — no configuration needed. Just run your server with `node` or `bun`.

When running under Bun you can enable port reuse for load-balancing across multiple processes:

```ts
const server = new ZilaServer({
    port: 6589,
    reusePort: true // Bun only
});
```

For local HTTPS testing with self-signed certificates:

```ts
const server = new ZilaServer({
    port: 6589,
    https: {
        pathToCert: "cert/cert.pem",
        pathToKey: "cert/key.pem",
        allowSelfSigned: true
    }
});
```

## Cookie syncing

The server exposes a `/zilaws/cookieSync` HTTP endpoint that lets connected clients sync cookies set by the server. Cookies set from the server side (e.g. via `socket.setCookie(...)`) are delivered to the client through this endpoint.

You can configure the cookie sync behavior through server settings:

```ts
const server = new ZilaServer({
    port: 6589,
    // Restrict which origins may call the cookie sync endpoint (CORS).
    cookieSyncAllowedOrigins: ["https://app.example.com", "http://localhost:3000"],
    // Name of the cookie used to identify sessions (default: "zilaSession").
    // Change this to match your auth library's session cookie if needed.
    sessionTokenCookieName: "zilaSession"
});
```

> **Note:** If `cookieSyncAllowedOrigins` is omitted, the server reflects the request's `Origin` header. Set it explicitly in production.

## Waiters

ZilaWS has a unique function called `waiter`. Waiters (as their name suggests) can be awaited.
They resolve when the client side *MessageHandler* resolves or returns thus making it perfect for retrieving data from a client.
However if the client does not respond in time, waiters will resolve as *undefined*.
There are also [broadcastWaiters](https://zilaws.com/docs/waiters#broadcastwaiter).

### Parameters

#### Regular waiters

Regular waiters wait for a response for the amount of time specified by the `maxWaiterTime` property. This is a property of the ZilaServer class. This property can be set while creating the server through the options object or anytime with its property.

* `identifier`: The name of the [MessageHandler](https://zilaws.com/docs/server-api/recieving-data#waiting-for-data) on the other side of the connection.
* `...data`: A waiter (or a send) can be given any number of any data.

```ts
socket.waiter<T>(identifier: string, ...data: any[]): Promise<T | undefined>
```

#### Timeout Waiters

* `maxWaitingTime`: This paramater overrides the maximum waiting time for the corresponding `waiter` or `broadcastWaiter`. The value is in miliseconds.

```ts
socket.waiterTimeout<T>(identifier: string, maxWaitingTime: number, ...data: any[]): Promise<T | undefined>
```

### Example

### Client

```ts
const client = await connectTo("wss://yourhost.com:6589");

console.log(await client.waiter("GetValueOfPI", "Some string") as number); // --> 3.141592653589793
console.log(await client.waiterTimeout("GetValueOfPI", 1200, "Some string") as number); // --> 3.141592653589793
```

### Server

```ts
const server = new ZilaServer({
    port: 6589,
    https: {
        pathToCert: "cert/fullchain.pem",
        pathToKey: "cert/privkey.pem"
    }
});

server.setMessageHandler("GetValueOfPI", (param1: string) => {
    console.log(param1); // --> Some string
    return Math.PI;
});
```

## Extending the ZilaClient class

You have the ability to extend the ZilaClient which is a class for storing server side data and functions of a WS connection. Extending is good for storing extra data (or even declaring functions) associated with a client thus making it the best way to handle authentication.

```ts
/*You should not use the WebSocketClient constructor since it's a part of the `ws` npm package,
and is only exported to make the extending easier.*/
import { ZilaServer, ZilaClient, WebSocketClient, IncomingHttpHeaders } from "zilaws-server";

class MyClient extends ZilaClient {
    public clientData: {
        rank: "admin" | "user";
        username: string;
    }

    //In order to get access to the cookies, sadly you need to define the constructor by hand.
    constructor(
        socket: WebSocketClient,
        ip: string | undefined,
        server: ZilaServer,
        isBrowser: boolean,
        headers: IncomingHttpHeaders,
        cookies?: Map<string, string>
    ) {
        super(socket, ip, server, isBrowser, headers, cookies);
        
        //This is the best place to authenticate the user.
        if(isBrowser && !AuthUserByBrowser(cookies?.get("loginToken"))) {
            this.kick("Wrong token");
            return;
        }else if (!AuthUserByHeader(headers["authorization"])) {
            this.kick("Wrong token");
            return;
        }

        this.clientData = {
            rank: "admin",
            username: "SomeUsername"
        }
    }
}

//Defining both the generic type and the clientClass is needed.
const server = new ZilaServer<MyClient>({
    port: 6589,
    logger: true,
    verbose: true,
    clientClass: MyClient
});

server.onceMessageHandler("Anything", (socket) => {
    socket.clientData.rank == "admin"; //--> true
    socket.clientData.username == "SomeUsername"; //--> true
});
```

## Extending the ZilaServer class

You also have the ability to extend the ZilaServer class if you need to. This comes in handy if for example you need to convert data automatically.

```ts
import { IServerSettings, ZilaClient, ZilaServer, ZilaWSCallback } from "zilaws-server";

enum MessageHandlers {
    Register,
    Login,
    //...
}

class MyServer<T extends ZilaClient> extends ZilaServer<T> {
    constructor(settings: IServerSettings) {
        super(settings);
    }

    setMessageHandler(identifier: MessageHandlers | string, callback: ZilaWSCallback<T>): void {
        super.setMessageHandler(identifier.toString(), callback);
    }
}

const server = new MyServer<MyClient>({
    port: 80,
    clientClass: MyClient
});

server.setMessageHandler(MessageHandlers.Login, async (socket: MyClient, username: string, password: string) => {
    //Logging in a user
    const dbUser = await CheckLoginCredentials(username, password);
    
    if(dbUser) {
        const loginToken = generateToken();
        socket.setCookie({
            name: "LoginToken",
            value: loginToken,
            expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30)
        });

        socket.clientData = dbUser;

        return "SUCCESS";
    }else{
        return "BAD_CREDENTIALS";
    }
});
```

## More

ZilaWS offers much more. Check out the [documentation](https://zilaws.com/)!
