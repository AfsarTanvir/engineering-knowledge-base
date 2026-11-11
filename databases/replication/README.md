# Replication

This folder started with one question:

> *"One `mysql` image, multiple containers, I update data in different
> containers — will it sync?"*

No. Each container gets its own private storage for `/var/lib/mysql` — the
`mysql` image declares it a `VOLUME`, so every container you start without
`-v` silently gets its own anonymous volume. Three containers are three
unrelated databases. Mounting one
volume into all of them does not fix that either: InnoDB assumes exactly one
`mysqld` owns a data directory, and a second one is refused or corrupts it.

The follow-up question is the one this folder answers: **then how does
replication actually keep two databases in sync?** The answer is that sync is a
**database-level protocol, not a filesystem trick**. One server writes down
every change it commits, the other fetches that record over the network and
replays it. Everything else — GTIDs, lag, semi-sync, multi-writer clusters — is
detail on top of that one idea.

These notes use **MySQL 8.4**, because the question was about MySQL, and every
piece of output shown comes from a real MySQL 8.4 lab running in Docker. (The
few things that cannot run in a local lab, such as MySQL Router and Galera, are
described without output.) The
rest of `databases/` is PostgreSQL-centric. The PostgreSQL version of the same
ideas (WAL streaming, lag, read-after-write) lives in
[../operations/04-read-replicas-and-replication-lag.md](../operations/04-read-replicas-and-replication-lag.md).

> **📌 The whole folder in one line:** a replica is a second database that
> replays the first one's change log over the network — and every replication
> problem is about what that log contains, how far behind the replay is, or who
> is allowed to write.

## Files

1. [MySQL Binlog Replication — Part 1](01-mysql-binlog-replication-part-1.md) —
   what the binary log is (and how it differs from the redo log), ROW versus
   STATEMENT events, the receiver and applier threads, the relay log, and
   reading `SHOW REPLICA STATUS` and a decoded binlog event.
2. [MySQL Binlog Replication — Part 2](01-mysql-binlog-replication-part-2.md) —
   why file-and-position coordinates are fragile, GTIDs and auto-positioning,
   errant transactions and `super_read_only`, async versus semi-sync and what
   each loses on failover, and binlog retention.
3. [Replication Lag in MySQL](02-replication-lag-in-mysql.md) — why replicas
   fall behind, why `Seconds_Behind_Source` misleads, better ways to measure,
   the parallel applier, and read-your-writes with GTIDs.
4. [Group Replication — Part 1](03-group-replication-part-1.md) — why two
   servers cannot share one disk, how a group agrees on writes, certification
   and conflicts, and single-primary versus multi-primary.
5. [Group Replication — Part 2](03-group-replication-part-2.md) — quorum,
   network partitions and split-brain, failover, InnoDB Cluster, Galera, and
   what a small SaaS should actually run.

**The Docker side of the original question** lives next to the other Docker
notes: [cloud-devops/docker/stateful-containers.md](../../cloud-devops/docker/stateful-containers.md)
shows the three-containers-three-databases problem, the shared-volume failure,
and a working source + replica pair in Compose.

## Read in this order

Start with [stateful-containers.md](../../cloud-devops/docker/stateful-containers.md):
it proves the problem these files solve. Then read 1 → 5 in order. File 2 relies
on the threads and binlog from file 1. File 3 relies on GTIDs from file 2.
Files 4 and 5 build on all of them.

```text
 stateful-containers  →  01 binlog (1, 2)  →  02 lag
   the problem             the protocol         its cost
                                                   ↓
                              03 group replication (1, 2)
                              more than one writer
```

If you only need the practical part for an application, read files 1 and 3:
what a replica is, and how stale its reads can be.

## What you should be able to do after this folder

- Explain why three containers from one image never sync, and why a shared
  volume makes things worse rather than better.
- Draw the path of one committed row from the source's binlog to the replica's
  tables, naming every thread and file it passes through.
- Read `SHOW REPLICA STATUS\G` and say whether the replica is healthy, how far
  behind it is, and why `Seconds_Behind_Source` might be lying.
- Explain what a GTID is, why failover is easier with GTIDs than with file
  positions, and how a write on a replica creates an errant transaction.
- Say what async and semi-sync replication each lose when the source dies.
- Give a read-your-writes guarantee on a replica using a GTID and a wait
  instead of sending every read to the primary.
- Explain quorum, and why a multi-writer cluster needs three nodes, not two.

## Where this connects

- **The PostgreSQL equivalents:** WAL streaming, lag measurement, read-after-write
  and failover in [../operations/04-read-replicas-and-replication-lag.md](../operations/04-read-replicas-and-replication-lag.md).
- **Architecture level:** leader-follower, multi-leader and leaderless models in
  [system-design/foundational/database-replication.md](../../system-design/foundational/database-replication.md),
  and consistency trade-offs in
  [cap-theorem-and-consistency-models.md](../../system-design/foundational/cap-theorem-and-consistency-models.md).
- **Transactions and MVCC,** which replication replays rather than replaces:
  [../transactions-and-concurrency/](../transactions-and-concurrency/).
- **Containers and volumes:** [cloud-devops/docker/](../../cloud-devops/docker/).
