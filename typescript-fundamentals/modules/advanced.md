# Modules — Advanced

Once you've internalized "a file is private unless exported," the next layer is about *how* modules get found, loaded, and discarded at scale: how a bundler decides what to delete, how Node and bundlers disagree on resolving `./foo`, how a monorepo enforces boundaries between packages, and how modules become a substitute for a full DI framework. These are the things that bite you in a real production build, not a toy example.

## Table of Contents

1. [Dynamic `import()`](#dynamic-import)
2. [Tree-Shaking Mechanics](#tree-shaking-mechanics)
3. [Module Resolution: Node vs Bundler](#module-resolution-node-vs-bundler)
4. [Monorepo Package Boundaries](#monorepo-package-boundaries)
5. [Dependency Injection via Modules](#dependency-injection-via-modules)
6. [Why It Matters](#why-it-matters)
7. [Common Mistakes](#common-mistakes)
8. [Questions to Test Yourself](#questions-to-test-yourself)

---

## Dynamic `import()`

`import { x } from "./y"` is static — it's resolved at build time. `import()` is a function call that returns a `Promise`, resolved at *runtime*, wherever you write it.

```ts
// static import — always loaded, even if never used
import { renderChart } from "./chart";

// dynamic import — only loaded when this code path actually runs
async function showAdvancedReport() {
  const { renderChart } = await import("./chart");
  renderChart();
}
```

This is the mechanism behind **code splitting**: a bundler (Webpack, Vite, esbuild) sees `import()` and automatically puts `./chart` and everything it depends on into its own separate JS chunk, fetched over the network only when `showAdvancedReport` is actually called.

```ts
// route-based code splitting — a very common real pattern
const routes = {
  "/": () => import("./pages/Home"),
  "/settings": () => import("./pages/Settings"), // not downloaded until visited
  "/admin": () => import("./pages/Admin"),       // heavy admin bundle, rarely needed
};
```

The type of `import("./chart")` is inferred as `Promise<typeof import("./chart")>` — TypeScript still gives you full autocomplete on the resolved module's exports.

## Tree-Shaking Mechanics

Tree-shaking is a bundler optimization: **remove exported code nobody actually imports.** It's not magic — it depends on your code being *statically analyzable*.

```ts
// utils.ts
export function used() { return 1; }
export function unused() { return 2; } // never imported anywhere

// app.ts
import { used } from "./utils";
console.log(used());
// a bundler doing tree-shaking will NOT include `unused` in the final bundle
```

Tree-shaking relies on ES module syntax being static (`import`/`export` at the top level, not conditional or computed) because the bundler needs to prove, without running the code, that a given export is never reached.

```ts
// this DEFEATS tree-shaking — the bundler can't statically know which export you want
const modName = condition ? "featureA" : "featureB";
const mod = require(modName); // CommonJS, dynamic string — opaque to static analysis

// this defeats it too, even with ESM syntax:
export * from "./utils"; // re-exporting everything makes usage harder to trace
```

Also watch for **side effects**: if a module runs code at the top level (not just declares exports), a bundler generally can't safely remove it even if nothing imports its exports.

```ts
// polyfills.ts
import "./polyfills"; // no named import — pure side effect, e.g. patches Array.prototype
// bundlers keep this because deleting it could change runtime behavior
```

`package.json`'s `"sideEffects": false` field is how library authors tell bundlers "none of my files have side effects, it's safe to drop anything unused" — getting this wrong (marking a side-effectful file as side-effect-free) causes real production bugs where a needed polyfill/CSS import silently disappears from the bundle.

## Module Resolution: Node vs Bundler

"Resolution" is the algorithm that turns `import { x } from "./foo"` into an actual file. There isn't one universal algorithm — TypeScript's `moduleResolution` setting picks which one to emulate, and getting it wrong causes "works when I run it, but the build fails" (or vice versa).

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "moduleResolution": "node16", // mimics Node's actual runtime resolution
    // or "bundler" — mimics how Vite/esbuild/Webpack resolve, which is more lenient
  }
}
```

Key differences that actually bite people:

```ts
// Node ESM resolution (moduleResolution: "node16"/"nodenext") requires
// explicit file extensions for relative imports:
import { add } from "./math.js"; // ✅ required, even though the source file is math.ts
import { add } from "./math";    // ❌ error under strict Node ESM resolution

// "bundler" mode (what most frontend tooling assumes) allows the extension-less form
// because the bundler itself resolves ".ts"/".tsx"/".js" — Node's runtime never sees it
import { add } from "./math"; // ✅ fine, bundler resolves it
```

Package resolution also differs: Node respects a package's `"exports"` field strictly (blocking access to files not explicitly listed, even if they exist on disk), while older bundlers historically fell back to guessing paths. Modern bundlers now generally respect `"exports"` too — meaning a package that doesn't list a deep path (`lodash/debounce`) in `"exports"` will fail to resolve even though the file is physically there.

```jsonc
// a library's package.json
{
  "exports": {
    ".": "./dist/index.js",
    "./utils": "./dist/utils.js"
    // "./internal/helpers.js" is NOT listed here —
    // consumers importing it directly will get a resolution error,
    // even though the file exists in the published package
  }
}
```

## Monorepo Package Boundaries

In a monorepo (Turborepo, Nx, pnpm workspaces), "module" boundaries stop being just files — they become whole **packages**, and enforcing which package can import from which is a real architectural concern.

```
apps/
  web/            → depends on packages/ui, packages/api-client
  admin/          → depends on packages/ui, packages/api-client
packages/
  ui/             → shared components, should depend on NOTHING app-specific
  api-client/     → typed API layer
  utils/          → depends on nothing else in the monorepo
```

```ts
// packages/ui/Button.tsx — a boundary violation
import { useCurrentUser } from "../../apps/web/hooks/useCurrentUser";
// ❌ a shared package now depends on a specific app —
// packages/ui can no longer be used by apps/admin without dragging in apps/web's code,
// and it creates a circular risk (web depends on ui, ui depends on web)
```

Tools enforce this at two levels:
- **`package.json` dependencies** — `packages/ui` simply doesn't list `apps/web` as a dependency, so a raw `import` across that boundary won't even resolve under strict workspace resolution.
- **Lint rules** (e.g. `eslint-plugin-boundaries`, Nx module boundary rules) that statically forbid certain import paths between marked "layers," failing CI before the code ever ships.

The underlying principle is the same one as inside a single file: exports define a public API, and everything not exported (or not listed in `package.json`'s public entry points) is private — just scaled up from "function" to "whole package."

## Dependency Injection via Modules

You don't need a DI *framework* to get DI's core benefit (swappable implementations, easy testing) — plain modules already give you it, because an `import` is just a reference you can redirect.

```ts
// logger.ts — the "interface" is just the module's shape
export interface Logger {
  log(msg: string): void;
}

// console-logger.ts
export const consoleLogger: Logger = {
  log: (msg) => console.log(`[LOG] ${msg}`),
};

// order-service.ts — depends on the Logger type, not a concrete implementation
import type { Logger } from "./logger";

export function createOrderService(logger: Logger) {
  return {
    placeOrder(id: string) {
      logger.log(`Order placed: ${id}`);
    },
  };
}

// app.ts — wiring happens here, at the "composition root"
import { consoleLogger } from "./console-logger";
import { createOrderService } from "./order-service";

const orderService = createOrderService(consoleLogger);
```

```ts
// tests can inject a fake logger — no framework, no mocking library required
const fakeLogger: Logger = { log: () => {} };
const testService = createOrderService(fakeLogger);
```

This pattern — accepting dependencies as parameters instead of importing concrete implementations directly inside the function that uses them — is "dependency injection." Modules give you the seams (interfaces/types as the contract, factory functions as the injection point) for free; a DI *container* (like NestJS's or InversifyJS's) just automates the wiring step for large graphs of dependencies.

## Why It Matters

- Dynamic `import()` is the difference between a 2MB initial bundle a user waits on and a 200KB one that loads the rest on demand.
- Misunderstanding tree-shaking silently bloats production bundles with dead code — it doesn't error, it just ships megabytes nobody asked for.
- A resolution mismatch between `tsconfig` and the actual runtime (Node vs bundler) produces confusing "works locally, breaks in CI" failures that look unrelated to modules at all.
- Monorepos without enforced boundaries devolve into a ball of mud indistinguishable from one giant app, defeating the entire reason to split into packages.

## Common Mistakes

- Leaving `moduleResolution` mismatched with the actual runtime target (writing extension-less imports meant for a bundler, then running the compiled output directly under Node ESM).
- Assuming `import()` alone guarantees a separate network chunk — it depends on bundler configuration and can be merged back if not set up for splitting.
- Marking a package `"sideEffects": false` without auditing every file, silently dropping needed side effects (CSS imports, polyfills) in production only.
- Letting "shared" packages accumulate one-off app-specific imports until they're no longer actually shareable.
- Using `import()` for logic that always needs to run immediately — adding an unnecessary async boundary and loading spinner for no real benefit.

## Questions to Test Yourself

1. What's the actual mechanism that turns an `import()` call into a separate downloaded file, and does merely writing `import()` guarantee that?
2. Why can a bundler tree-shake `export * from "./utils"` less effectively than named re-exports?
3. Why would `import { add } from "./math"` fail under Node's ESM resolution but succeed under a bundler's resolution, for the exact same source file?
4. In a monorepo, why is `packages/ui` importing something from `apps/web` a design smell even if it "works"?
5. How does passing a `Logger` interface into `createOrderService` as a parameter make testing easier than importing `consoleLogger` directly inside the function?
