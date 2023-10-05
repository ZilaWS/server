- Fixed an issue with importing the library.

## Breaking Changes

### New importing
From now on, there is no default export.

ESM

```ts
import { ZilaConnection } from "zilaws-server";
```

CommonJS
```ts
const { ZilaConnection } = require("zilaws-server");
```