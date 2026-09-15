# Promises and async/await — Advanced

The basics cover promise states, `async`/`await` syntax, and `Promise.all`/`allSettled`. This file covers the promise combinators you haven't used yet, how to actually cancel an in-flight async operation, async iteration, and how to bridge old callback-based APIs into promises. See [async-await-promise.md](./async-await-promise.md) for the basics this builds on.

## Table of Contents

1. [Promise Combinators Deep Dive](#promise-combinators-deep-dive)
2. [Cancellation with AbortController](#cancellation-with-abortcontroller)
3. [Async Iterators and Async Generators](#async-iterators-and-async-generators)
4. [Backpressure, Conceptually](#backpressure-conceptually)
5. [Promisifying Callback APIs](#promisifying-callback-apis)
6. [Why It Matters](#why-it-matters)
7. [Common Mistakes](#common-mistakes)
8. [Questions to Test Yourself](#questions-to-test-yourself)

---

## Promise Combinators Deep Dive

The base file covers `Promise.all` (fail-fast) and `Promise.allSettled` (wait for everything). There are two more combinators with distinct semantics that solve different problems.

**`Promise.race`** settles as soon as the FIRST promise settles — whether it fulfills or rejects.

```ts
// classic use: enforce a timeout on a slow operation
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms)
  );
  return Promise.race([promise, timeout]); // whichever settles first "wins"
}

const result = await withTimeout(fetchSlowReport(), 3000);
// if fetchSlowReport() takes longer than 3s, the timeout promise rejects first
// and withTimeout rejects — even though fetchSlowReport() keeps running in the background!
```

Important gotcha: `Promise.race` doesn't cancel the losing promises — they keep running, they're just ignored. If `fetchSlowReport()` eventually resolves after the timeout already "won," its result is silently discarded (see AbortController below for real cancellation).

**`Promise.any`** waits for the FIRST fulfillment, ignoring rejections — the opposite priority of `race`. It only rejects if *all* promises reject (with an `AggregateError`).

```ts
// classic use: try multiple redundant sources, take whichever succeeds first
async function fetchFromFastestMirror(urls: string[]) {
  try {
    return await Promise.any(urls.map((url) => fetch(url).then((r) => r.json())));
  } catch (err) {
    // err is an AggregateError — ALL mirrors failed
    console.error("All mirrors failed:", (err as AggregateError).errors);
    throw err;
  }
}
```

Side-by-side summary:

```text
Promise.all        → waits for ALL, rejects fast on ANY rejection
Promise.allSettled  → waits for ALL, never rejects, gives you status per item
Promise.race        → settles on the FIRST settlement (fulfilled OR rejected)
Promise.any          → settles on the FIRST fulfillment, ignores rejections until all fail
```

Picking the wrong one is a real bug source: using `Promise.race` to "get whichever finishes first" when you actually meant `Promise.any` (so that a fast *failure* doesn't wrongly win over a slower success).

## Cancellation with AbortController

Promises themselves have **no built-in cancellation** — once started, a promise-based operation runs to completion (or rejection) regardless of whether you still care about the result. `AbortController` is the standard mechanism for signaling "stop, I don't need this anymore" to APIs that support it.

```ts
async function searchWithCancellation(query: string, signal: AbortSignal) {
  const response = await fetch(`/api/search?q=${query}`, { signal });
  return response.json();
}

const controller = new AbortController();

searchWithCancellation("typescript", controller.signal)
  .then((results) => console.log(results))
  .catch((err) => {
    if (err.name === "AbortError") {
      console.log("search was cancelled"); // expected, not a real failure
    } else {
      throw err;
    }
  });

// user typed something new before the first search finished — cancel it
controller.abort();
```

This is exactly how a real search-as-you-type input avoids race conditions: without cancellation, an old slow request could resolve *after* a newer fast one and overwrite the UI with stale results.

```ts
// BROKEN — no cancellation, stale responses can overwrite fresh ones
let latestQuery = "";
async function onInput(query: string) {
  latestQuery = query;
  const results = await search(query); // slow request from an OLD keystroke
  renderResults(results); // overwrites newer results if this resolves late!
}

// FIXED — abort the previous request whenever a new one starts
let currentController: AbortController | null = null;
async function onInput(query: string) {
  currentController?.abort(); // cancel whatever was in flight
  currentController = new AbortController();
  try {
    const results = await search(query, currentController.signal);
    renderResults(results);
  } catch (err: any) {
    if (err.name !== "AbortError") throw err;
  }
}
```

You can also build your own abortable operations for non-`fetch` code by checking `signal.aborted` manually or listening for the `"abort"` event:

```ts
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}
```

## Async Iterators and Async Generators

An async generator (`async function*`) lets you `yield` values over time, each possibly requiring an `await` — perfect for streaming data (paginated APIs, file reads, WebSocket messages) without loading everything into memory first.

```ts
async function* fetchAllPages(baseUrl: string) {
  let page = 1;
  while (true) {
    const res = await fetch(`${baseUrl}?page=${page}`);
    const data = await res.json();
    if (data.items.length === 0) return; // no more pages
    yield data.items; // hand this page back to the consumer, then pause here
    page++;
  }
}

// consume with for-await-of — pulls one page at a time, only as needed
for await (const items of fetchAllPages("/api/users")) {
  console.log(`Got ${items.length} users`);
  if (shouldStopEarly(items)) break; // stops fetching further pages entirely
}
```

The key benefit over `Promise.all`-ing every page upfront: **memory and network usage stay proportional to what you actually consume**, not the total dataset size. If the consumer `break`s after 2 pages, pages 3+ are never even requested.

```ts
// contrast: eager version loads EVERYTHING into memory before you can process any of it
async function fetchAllPagesEager(baseUrl: string) {
  const allItems = [];
  let page = 1;
  while (true) {
    const data = await fetch(`${baseUrl}?page=${page}`).then((r) => r.json());
    if (data.items.length === 0) break;
    allItems.push(...data.items); // grows unboundedly before caller sees anything
    page++;
  }
  return allItems;
}
```

## Backpressure, Conceptually

Backpressure is what happens when a **producer generates data faster than a consumer can process it**. Without a mechanism to signal "slow down," the excess data has to go somewhere — usually an ever-growing in-memory buffer, which is a memory leak in slow motion.

```text
Producer (fast: reads a 10GB file at disk speed)
    ↓ data flows here
Consumer (slow: uploads each chunk to a rate-limited API)

Without backpressure: the producer keeps reading and buffering ALL of it in memory
                       while the consumer slowly drains it — memory grows unbounded.

With backpressure: the producer PAUSES reading once the buffer is full,
                    and resumes only once the consumer catches up.
```

Node's Streams (`fs.createReadStream().pipe(slowWritable)`) implement backpressure natively — `.pipe()` automatically pauses the readable stream when the writable side's internal buffer is full, and resumes it once drained. Async generators give you a *simpler* form of the same idea for free: because `for await...of` only pulls the next value when the consumer asks for it (via `.next()`), a slow consumer naturally makes a well-written async generator producer wait too — you get pull-based backpressure without any extra buffering code.

```ts
// the generator only computes/fetches the NEXT chunk when the consumer is ready for it —
// this is backpressure by construction, not by explicit buffer management
async function* chunkedUploadSource(file: LargeFile) {
  for (const chunk of file.chunks()) {
    yield await prepareChunk(chunk); // waits here until the consumer pulls again
  }
}
```

The concept matters even if you never implement a custom stream: it's why "just read everything into memory and process it" breaks down at scale (a 10GB file, a million-row DB cursor), and why APIs like Node streams, async iterators, and even React's Suspense streaming exist — they all let a slow consumer throttle a fast producer instead of the producer running unchecked.

## Promisifying Callback APIs

Older Node APIs and many third-party libraries still use the `(err, result) => {}` callback convention instead of promises. Wrapping them lets you use them with `async`/`await`.

```ts
import { readFile } from "fs";

// manual promisify
function readFileAsync(path: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    readFile(path, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

const contents = await readFileAsync("./config.json");
```

Node ships a built-in helper for the standard `(err, result)` shape so you rarely need to write this by hand:

```ts
import { promisify } from "util";
import { readFile } from "fs";

const readFileAsync = promisify(readFile);
const contents = await readFileAsync("./config.json", "utf-8");
```

A generic version for functions with multiple result values or non-standard signatures still needs to be handwritten, since `promisify` assumes exactly one `(err, value)` callback shape:

```ts
// a callback API with a non-standard shape: success/failure as separate callbacks
declare function legacyRequest(
  url: string,
  onSuccess: (body: string) => void,
  onError: (err: Error) => void
): void;

function requestAsync(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    legacyRequest(url, resolve, reject); // resolve/reject ARE valid callback functions
  });
}
```

## Why It Matters

`Promise.race` vs `Promise.any` is a one-word difference in your code but a completely different failure mode in production — picking the wrong one either lets a slow failure "win" over a fast success, or vice versa. Not knowing about `AbortController` leads to stale-response race conditions in every search-as-you-type or autocomplete feature. And not understanding backpressure is why "works fine locally with 100 rows" scripts fall over in production with 10 million rows — you loaded it all into memory because nothing told the producer to slow down.

## Common Mistakes

- Using `Promise.race` for a "first successful result wins" scenario, when a fast rejection will incorrectly win over a slower success (that's what `Promise.any` is for).
- Assuming `Promise.race`/`withTimeout` actually cancels the losing operation — it doesn't; the "loser" keeps running and consuming resources unless you explicitly abort it.
- Not cancelling a previous in-flight request before starting a new one in a search/autocomplete UI, causing stale results to overwrite fresh ones.
- Eagerly loading an entire paginated/streamed dataset into memory (`await Promise.all` over everything) instead of using an async generator to process it incrementally.
- Writing a promisified wrapper that forgets to handle the error-first callback argument, silently swallowing errors.

## Questions to Test Yourself

1. What's the difference in outcome between `Promise.race` and `Promise.any` when one promise rejects quickly and another resolves slowly?
2. Why doesn't `Promise.race` actually stop the "losing" promise from continuing to run?
3. How does `AbortController` prevent a stale network response from overwriting a newer one in a search-as-you-type feature?
4. Why does a `for await...of` loop over an async generator use less memory than `await`-ing an array of all results upfront?
5. What problem does backpressure solve, and what happens if a fast producer has no way to signal a slow consumer to catch up?
