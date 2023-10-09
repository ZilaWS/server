# ZilaWS Server

## ZilaWS is a blazingly fast and very lightweight library that provides an extremely easy-to-use way to transmit data via websockets between clientside and serverside using eventhandlers and async waiters

<div style="text-align: center;">
<a href="https://github.com/WarstekHUN/typescript-npm-package-template/actions/workflows/test.yml">
    <img src="https://github.com/WarstekHUN/typescript-npm-package-template/actions/workflows/test.yml/badge.svg">
<img src="https://img.shields.io/badge/License%20-%20MIT%20-%20brightgreen">
</a>
<br>
<img src="./.coverage-badges/badge-branches.svg">
<img src="./.coverage-badges/badge-functions.svg">
<img src="./.coverage-badges/badge-lines.svg">
<img src="./.coverage-badges/badge-statements.svg">
</div>

<p style="text-align: center; margin-block: 30px;">
    <img src="logo.png" width="240">
</p>

<h2 style="text-align: center">
    <a href="https://zilaws.com" target="_blank" rel="noopener noreferrer">Documentation</a>
</h2>

<h3 style="text-align: center">Looking for the <a href="https://www.npmjs.com/package/zilaws-client" target="_blank" rel="noopener noreferrer">zilaws-client</a> package?</h3>

<p>The ZilaWS Server can accept WS connections from non ZilaWS clients but won't work as expected.</p>

<h2>
Waiter example
</h2>

### Client

```ts
const client = await connectTo("wss://yourhost.com");

console.log(await client.waiter("GetValueOfPI", "Some string") as number); // --> 3.141592653589793
```

### Server

```ts
client.setMessageHandler("SomeIdentifier", (param1: string) => {
    console.log(param1); // --> Some string
    return Math.PI;
});
```
