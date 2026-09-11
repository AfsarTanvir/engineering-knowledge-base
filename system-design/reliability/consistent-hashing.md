# Consistent Hashing

Consistent hashing solves one specific problem: when you add or remove a
server from a pool (a cache, a shard, a load-balanced backend), how do you
avoid remapping *almost everything* to a new server? Naive hashing
(`hash(key) % num_servers`) remaps nearly every key the moment the server
count changes — consistent hashing keeps that remapping down to roughly
`1/N` of the keys.

## Table of Contents

1. [The Problem with `hash(key) % N`](#the-problem-with-hashkey--n)
2. [The Hash Ring](#the-hash-ring)
3. [Adding a Node](#adding-a-node)
4. [Removing a Node](#removing-a-node)
5. [Virtual Nodes: Fixing Uneven Load](#virtual-nodes-fixing-uneven-load)
6. [Implementation](#implementation)
7. [Who Uses This](#who-uses-this)
8. [When You Don't Need It](#when-you-dont-need-it)
9. [Quick Reference](#quick-reference)

---

## The Problem with `hash(key) % N`

The obvious way to distribute keys across N servers is to hash the key and
take the remainder:

```python
server_index = hash(key) % num_servers
```

This distributes evenly — until `num_servers` changes:

```
num_servers = 4: hash("user:1020") % 4 = 2  -> Server 2
num_servers = 5: hash("user:1020") % 5 = 0  -> Server 0   (moved!)
```

Adding or removing even a single server changes the modulus, which
changes the result for the overwhelming majority of keys — not just the
keys that logically needed to move. For a cache, this means a near-total
cache wipe every time you scale the pool. For a sharded database, it
means re-migrating almost all your data for a one-node change.

## The Hash Ring

Consistent hashing places both servers and keys on the same conceptual
ring (a hash space that wraps around, e.g., 0 to 2³²-1). Each key belongs
to the first server found walking clockwise from the key's position:

```
                    Server A (hash: 10)
                   /
        Server D (hash: 300)      Server B (hash: 90)
              |                    |
              +---- ring wraps ----+
                   \
                    Server C (hash: 200)

Key "user:1020" hashes to 150 -> walks clockwise -> lands on Server C (200)
Key "user:2045" hashes to 50  -> walks clockwise -> lands on Server B (90)
```

Both servers and keys are positioned by the *same* hash function, so a
key's server assignment is just "find the nearest server clockwise" —
no modulus, no dependency on the total server count.

## Adding a Node

Insert the new server at its hash position on the ring. Only the keys
that fall between the new server and the previous server (going
clockwise) move to it — everything else on the ring is completely
unaffected:

```
Before: ... Server B (90) -----------------> Server C (200) ...
             keys 91-200 belong to Server C

After adding Server E at hash 150:
        ... Server B (90) --> Server E (150) --> Server C (200) ...
             keys 91-150 now belong to Server E   keys 151-200 still belong to Server C
```

Only keys 91-150 moved (to Server E). Keys 151-200 stayed exactly where
they were, still pointing at Server C. Server A, Server D, and their key
ranges are entirely untouched.

## Removing a Node

The reverse: when a server is removed, only its keys move — to the next
server clockwise. Every other server's keys are unaffected:

```
Server C (200) removed -> its keys (151-200) now fall to the next node clockwise (Server D, 300)
Server A, B, D's existing key ranges: unchanged
```

This is the entire point — a node failure or scale-down event causes
roughly `(keys on that node)`'s worth of remapping, not a wholesale
reshuffle of the whole cluster.

## Virtual Nodes: Fixing Uneven Load

With only one ring position per physical server, a small number of
servers can end up with wildly uneven ranges just by chance — one server
might cover 60% of the ring, another 5%. **Virtual nodes** fix this by
giving each physical server many positions on the ring instead of one:

```python
# Instead of one point per server...
ring["Server A"] = hash("Server A")

# ...give each server many virtual points, spread around the ring
for i in range(150):  # 150 virtual nodes per physical server is a common default
    ring[hash(f"Server A#{i}")] = "Server A"
```

More virtual nodes per server smooths out the ring's coverage — each
physical server ends up with many small, scattered ranges instead of one
big contiguous one, so the law of averages keeps each server's total
share close to `1/N` even with few physical servers.

## Implementation

```python
import bisect
import hashlib

class ConsistentHashRing:
    def __init__(self, nodes=None, virtual_nodes=150):
        self.virtual_nodes = virtual_nodes
        self.ring = {}          # hash position -> physical node
        self.sorted_keys = []   # sorted hash positions, for binary search
        for node in nodes or []:
            self.add_node(node)

    def _hash(self, key):
        return int(hashlib.md5(key.encode()).hexdigest(), 16)

    def add_node(self, node):
        for i in range(self.virtual_nodes):
            h = self._hash(f"{node}#{i}")
            self.ring[h] = node
            bisect.insort(self.sorted_keys, h)

    def remove_node(self, node):
        for i in range(self.virtual_nodes):
            h = self._hash(f"{node}#{i}")
            del self.ring[h]
            self.sorted_keys.remove(h)

    def get_node(self, key):
        if not self.ring:
            return None
        h = self._hash(key)
        idx = bisect.bisect(self.sorted_keys, h) % len(self.sorted_keys)
        return self.ring[self.sorted_keys[idx]]

ring = ConsistentHashRing(nodes=["cache-1", "cache-2", "cache-3"])
ring.get_node("user:1020")  # -> "cache-2" (deterministic for this key + node set)

ring.add_node("cache-4")
ring.get_node("user:1020")  # -> unchanged for most keys, only ~1/4 remap
```

`bisect` gives an O(log n) lookup for "first node clockwise from this
hash" — the sorted position list plus binary search is the standard way
to implement the ring efficiently without a linear scan.

## Who Uses This

- **Memcached client libraries** — distributing cache keys across a pool
  of cache servers without a stampede on every scaling event
- **DynamoDB, Cassandra, Riak** — sharding data across nodes in the
  cluster, with virtual nodes as a core part of their partitioning scheme
- **Load balancers** — session affinity (routing the same client
  consistently to the same backend) without a central lookup table
- **CDN request routing** — mapping a content key to the edge node
  responsible for caching it

## When You Don't Need It

- **A fixed, rarely-changing set of shards** — if the server count almost
  never changes, the remapping cost of `% N` is a non-issue; consistent
  hashing solves a problem you don't have.
- **A central coordinator already tracks placement** — if you have a
  metadata service mapping keys to nodes explicitly (common in some
  distributed databases), you don't need a hash ring — the coordinator
  already avoids the remapping problem a different way.
- **Small scale** — for a handful of cache nodes where a full cache
  warm-up on scaling events is cheap and infrequent, the simplicity of
  `hash(key) % N` may not be worth replacing.

---

## Quick Reference

| Scenario                                    | `hash(key) % N`                     | Consistent hashing                    |
| :------------------------------------------------ | :---------------------------------------- | :------------------------------------------- |
| Add/remove one server                              | Remaps nearly all keys                      | Remaps roughly `1/N` of keys                   |
| Implementation complexity                          | Trivial                                     | Moderate — ring, virtual nodes, binary search    |
| Load distribution with few servers                 | Even, but only until the count changes        | Even, with virtual nodes smoothing small-N skew   |
| Common use case                                    | Fixed shard count, rarely rebalanced           | Elastic pools (caches, load balancers, storage clusters) |

**Bottom line:** reach for consistent hashing whenever the number of
nodes in a pool changes over time (scaling, failures) and you want to
minimize the disruption each change causes. Use virtual nodes (100-200
per physical node is a typical range) so a small cluster still gets even
load distribution.
