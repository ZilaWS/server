# v1.2.0

## Additions

### Cookies

- The cookies from the WS client's browser now can be accessed via the `cookies` property.
- You can now set cookies from the serverside if the client is connected from a browser using `setCookie`.
- You can now delete cookies from the targeted client's browser directly from the serverside using the `removeCookie` function.
- The client can now sync the cookies to the serverside
  - New local event: `onCookieSync`

### Extendable clients

- When creating a server you can now specify a custom ZilaClient class

  ```ts
  class MyClient extends ZilaClient {
    public clientData: {
      rank: "admin" | "user";
      username: string;
    }

  constructor(socket: WebSocket, ip: string | undefined, server: ZilaServer, isBrowser: boolean, headers: IncomingHttpHeaders, cookies?: Map<string, string>) {
    super(socket, ip, server, isBrowser, headers, cookies);

      //This is the best place to authenticate the user.
      if(!AuthUser(cookies?.get("loginToken"))) {
        this.kick("Wrong token");
        return;
      } 

      this.clientData = {
        rank: "admin",
        username: "SomeUsername"
      }
    }
  }

  const server = new ZilaServer<MyClient>({
    port: 6589,
    logger: true,
    verbose: true,
    clientClass: MyClient
  });

  server.onceMessageHandler("Anything", (socket) => {
    socket.clientData == {
      rank: "admin",
      username: "SomeUsername"
    }; //--> true
  });
  ```

### Others

- Checks for passing a function down to a client has been removed. The built-in JSON serializer ingores functions by default.
- **Breaking change:** broadcastWaiter
  - Fixed a bug where if one of the clients didn't respond, this Promise would not resolve.
  - This function now requires an extra `maxWaitTime` parameter.
- A set of the server's actively connected clients can now be accessed through a the `clients` property of the corresponding server.
- ILogger interface typeguard for text parameter.
- Added property `isBrowser` to ZilaClient. This determines if the client's environment is a browser on not.
- The WS server is now powered with a seperate HTTP/HTTPS server.
