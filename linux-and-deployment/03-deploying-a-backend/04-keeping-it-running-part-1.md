# Keeping It Running — Part 1

Deploying is an event. It starts, it finishes, you close the laptop. Operating
is not an event — it is the state your system is in for the other 99.9% of the
time, while you are asleep, on holiday, or writing a different feature.

This part is about noticing problems before your users do, and about the one
thing that decides whether a bad day is an hour of annoyance or the end of the
project: backups.

> **📌 In one line:** watch from outside the machine, alert only on things you
> would get out of bed for, and treat a backup you have never restored as no
> backup at all.

## Table of Contents

1. [The Shift in Mindset](#the-shift-in-mindset)
2. [The Monitoring Minimum](#the-monitoring-minimum)
3. [Watching From Outside](#watching-from-outside)
4. [Alerting You Will Actually Respond To](#alerting-you-will-actually-respond-to)
5. [Backups](#backups)
6. [The Restore Drill](#the-restore-drill)
7. [Disk Space and Log Rotation](#disk-space-and-log-rotation)
8. [Common Mistakes](#common-mistakes)
9. [Questions to Test Yourself](#questions-to-test-yourself)
10. [Related](#related)

---

## The Shift in Mindset

Up to now every question has had a finish line. Does the image build? Does the
container start? Did the deploy succeed? You run a command, you get an answer,
you move on.

Operating has no finish line. The questions change shape:

```text
  Deploying asks:        Operating asks:
  -----------------      -------------------------------
  Did it work?           Is it still working, right now?
  Is it correct?         Will it still be correct in March?
  Did I break it?        Will I find out before a user does?
```

Nobody will tell you the disk is 94% full. No test fails when a certificate has
nineteen days left. The queue that stopped draining at 02:00 does not throw an
exception — it just quietly stops sending invoices.

This is why monitoring is not optional even for a side project with ten users.
**The purpose of monitoring is to turn silent failures into loud ones.** Not to
produce dashboards you look at. To wake you up, exactly when it matters.

> **💡 Tip:** Set all of this up on a calm afternoon, before anything has gone
> wrong. Setting up monitoring during an incident is how you end up with alerts
> that are wrong in exactly the way the incident was.

---

## The Monitoring Minimum

For one small app, this is the whole list. Seven things. More than this and you
will stop looking; fewer and you will miss something real.

| What to watch | Why it matters | A bad value looks like | Where it comes from |
|---|---|---|---|
| **Uptime, from outside** | The only check that catches "the whole box is down" | Two failed probes in a row | A free external checker |
| **Error rate** | The clearest signal that a deploy or a dependency broke | 5xx above ~1% of requests over 5 minutes | Your app's metrics or logs |
| **Response time (p95)** | Slow is a form of down, and it arrives first | p95 above twice its normal value | App metrics |
| **Disk space** | A full disk stops Postgres writes, logs, and Docker — all at once | Above 80% used | `df -h` on a timer |
| **Memory** | The OOM killer stops a process with no warning and no log from the app | Free memory near zero, or swap in use | `free -h` |
| **Queue depth and oldest job age** | Background work fails silently; no user sees a 500 | Oldest waiting job older than a few minutes | Queue dashboard |
| **Certificate expiry** | A predictable, total, self-inflicted outage | Fewer than 21 days remaining | External check or `certbot certificates` |

Why these seven and not thirty: each one catches a **different class** of
failure. Uptime catches the machine. Error rate catches the code. Latency
catches a struggling dependency. Disk and memory catch the slow leaks. Queue
depth catches the work nobody sees. Certificate expiry catches the calendar.

What *not* to start with: CPU percentage. On a small box it is high during
deploys, low during incidents, and almost never actionable on its own.

The metric types, percentiles, and why averages lie are in
[Metrics and Health Checks — Part 1](../../backend-fundamentals/08-logging-and-observability/04-metrics-and-health-checks-part-1.md).
What a health endpoint should actually return, and the readiness check that does
not cascade, are in
[Part 2](../../backend-fundamentals/08-logging-and-observability/04-metrics-and-health-checks-part-2.md).

---

## Watching From Outside

Everything on your server can be wrong at once. The app, the metrics agent, the
log shipper, the alerting script — all of them live on the machine that just
ran out of memory.

```text
  Internal monitoring:  app -> metrics agent -> alert
                        all three die together when the box dies
                                 -> silence, which looks like "everything is fine"

  External monitoring:  someone else's machine -> https://api.myapp.com/health
                        the box dying is exactly what it detects
```

So the **first** monitor you set up is an external one. UptimeRobot, Better
Stack, Healthchecks.io and others all have free tiers that are genuinely enough.
Configure it like this:

| Setting | Value | Why |
|---|---|---|
| URL | `https://api.myapp.com/health` | Through nginx and TLS, exactly as a user arrives |
| Interval | 1–5 minutes | Faster costs money and rarely changes your response |
| Failure threshold | 2 consecutive failures | One failure is often a network hiccup |
| Expected | HTTP 200 and the body contains `"status":"ok"` | A 200 with `{"status":"degraded"}` must not count as up |
| Notify | Push notification or SMS, not email | Email at 03:00 is not a notification |

Checking TLS expiry is usually a tick-box on the same monitor. Turn it on and
set it to warn at 21 days — well before certbot's 30-day renewal window closes,
so a failed renewal still leaves you three weeks.

> **📌 Remember:** the health endpoint must be honest. If it returns 200 while
> the database is unreachable, your external monitor will cheerfully report a
> dead application as healthy for hours.

A second, free and very effective check: a **dead-man's switch**. Your scheduled
backup job pings a URL when it finishes. If the ping does not arrive, you get
alerted. This catches the whole category of "the thing that was supposed to run
did not run", which nothing else catches.

```bash
# At the end of the backup script
curl -fsS -m 10 --retry 3 https://hc-ping.com/<uuid> > /dev/null
```

---

## Alerting You Will Actually Respond To

An alert has exactly one job: to make you act. An alert you look at and ignore
is worse than no alert, because it teaches you to ignore the next one too.

Three rules.

**1. Alert on symptoms, not causes.** "Error rate is 12%" means users are
suffering. "CPU is at 90%" might mean a deploy is building. Symptoms are what
you would want to be woken for; causes are what you look at *after* you are
awake. This is covered as a principle in
[Metrics and Health Checks — Part 2](../../backend-fundamentals/08-logging-and-observability/04-metrics-and-health-checks-part-2.md#alerting-on-symptoms-not-causes).

**2. Keep the list short enough that every alert is real.** For one app, five:

| Alert | Condition | Wakes you up? |
|---|---|---|
| Site down | 2 failed external checks | **Yes** |
| Error rate | 5xx above 2% for 5 minutes | **Yes** |
| Disk | Above 85% used | No — it is a tomorrow problem, unless above 95% |
| Queue stalled | Oldest waiting job older than 15 minutes | **Yes**, if it holds user-facing work |
| Certificate | Fewer than 21 days remaining | No — a weekday reminder |

**3. Route them where you will see them at night.** An email folder is not a
route. A phone notification with sound is.

```text
  WAKE ME:     site down, error rate, stalled user-facing queue
  TELL ME TODAY: disk above 85%, certificate under 21 days, backup did not run
  JUST LOG IT:   a single 500, one slow query, a deploy finishing
```

The failure mode to design against is **alert fatigue**. Six months of a
disk-usage alert firing every afternoon and clearing by itself teaches you to
swipe it away without reading. Then the one that says the disk is actually full
gets swiped away too.

```text
  // ❌ BROKEN - an alert that fires daily and resolves itself
  alert: "CPU above 70% for 1 minute"
  -> fires during every deploy, every backup, every nightly report
  -> muted within two weeks

  // ✅ FIXED - an alert that only fires when a user is affected
  alert: "5xx rate above 2% of requests for 5 minutes"
  -> fires a handful of times a year, and every one is real
```

---

## Backups

This is the section where the stakes are different from everything else in this
folder. A broken deploy costs you an evening. A lost database can end a
business, and no amount of good architecture compensates for it.

**What to back up**, in priority order:

| # | Thing | How | If you lose it |
|---|---|---|---|
| 1 | **The database** | `pg_dump`, or the managed provider's automatic backups | Unrecoverable. Everything your users created |
| 2 | **Uploaded files** | Object storage with versioning, not the VPS disk | Unrecoverable. Avatars, invoice PDFs, attachments |
| 3 | **Configuration** | The `.env` file, nginx config, `deploy.sh`, cron entries | Recoverable, but it costs you a painful day of remembering |
| 4 | The application code | git, already done | Nothing — it is on GitHub |
| 5 | Redis | Usually nothing | Depends: a cache is disposable, a queue is not |

Point 2 is why uploads belong in object storage (S3, R2, Spaces) rather than on
the server's disk — the storage provider handles durability and versioning, and
a rebuilt server loses nothing. See
[Object Storage and Serving Files](../../backend-fundamentals/12-files-and-integrations/02-object-storage-and-serving-files.md).

Here is a complete backup script for a self-hosted database:

```bash
#!/usr/bin/env bash
set -euo pipefail
STAMP=$(date -u +%Y-%m-%dT%H-%M-%SZ)
FILE="/var/backups/myapp/db-${STAMP}.sql.gz"
mkdir -p /var/backups/myapp

# --format=custom allows restoring a single table later; -Z9 compresses hard
pg_dump "$DATABASE_URL" --format=custom --compress=9 --file="${FILE}"

# OFF the machine. A backup on the same disk does not survive the disk.
rclone copy "$FILE" r2:myapp-backups/db/

# Retention: 14 days locally, lifecycle rules handle the remote side
find /var/backups/myapp -name 'db-*.sql.gz' -mtime +14 -delete

curl -fsS -m 10 --retry 3 "https://hc-ping.com/${HC_UUID}" > /dev/null
```

```cron
# /etc/cron.d/myapp-backup  — 02:17 UTC, deliberately not on the hour
17 2 * * * afsar /srv/myapp/backup.sh >> /var/log/myapp-backup.log 2>&1
```

```mermaid
flowchart LR
    DB[(PostgreSQL)] -->|pg_dump 02:17| L[local dump<br/>/var/backups]
    L -->|rclone copy| R[(object storage<br/>off the machine)]
    L -->|delete after 14 days| X[gone]
    R -->|lifecycle rule| Y[90 days then gone]
    L -->|restore drill, quarterly| T[throwaway Postgres<br/>prove the data is there]
    S[backup script finished] -->|ping| H[dead-man's switch<br/>alerts if no ping in 26h]
```

Three properties make this a real backup rather than a comforting ritual:

- **Off the machine.** A dump sitting on the same disk as the database protects
  you from `DROP TABLE` and from nothing else. Not from a dead disk, not from a
  deleted VPS, not from ransomware.
- **Automatic.** A backup you run manually is a backup that stops happening the
  week you get busy.
- **Monitored.** The `hc-ping` call means a backup that silently stops running
  tells you within a day.

> **⚠️ Warning:** If you use a managed database, backups are already automatic —
> but check the **retention period** and whether **point-in-time recovery** is
> on. The cheapest tiers often keep seven days and no PITR, which is fine for a
> disk failure and useless for "we deleted the wrong rows three weeks ago".

Also think about what a backup *contains*. A production dump holds every user's
personal data. Treat the file and its storage bucket with the same care as the
database itself: encrypted, access-controlled, and never downloaded onto a
laptop "just to look at something". Seeding a non-production environment is a
different problem, solved in
[Seeding and Test Data](../../backend-fundamentals/10-database-integration/05-seeding-and-test-data-part-1.md).

---

## The Restore Drill

**An untested backup is not a backup.** It is a file you believe in.

The ways a backup is silently useless are all boring and all common: the dump
has been zero bytes for six weeks because the password changed; it contains the
schema but no data because of a flag; the `rclone` target was renamed and the
upload has been failing into a log nobody reads; the dump restores but your app
cannot start against it because an extension is missing.

None of those are visible from looking at the backup. All of them are visible
within five minutes of trying to restore one.

**Do this now, and then once a quarter:**

```bash
# 1. Take the most recent backup from the REMOTE store, not the local copy.
#    The remote copy is the one you would actually have in a disaster.
rclone copy r2:myapp-backups/db/db-2026-10-04T02-17-00Z.sql.gz /tmp/

# 2. Start a throwaway PostgreSQL
docker run -d --name restore-test -e POSTGRES_PASSWORD=test \
  -p 127.0.0.1:5433:5432 postgres:16

# 3. Restore into it
gunzip -c /tmp/db-2026-10-04T02-17-00Z.sql.gz > /tmp/db.dump
pg_restore --clean --if-exists --no-owner \
  -d "postgres://postgres:test@127.0.0.1:5433/postgres" /tmp/db.dump
```

```text
pg_restore: creating TABLE "public.users"
pg_restore: creating TABLE "public.companies"
pg_restore: creating TABLE "public.invoices"
pg_restore: processing data for table "public.invoices"
```

```bash
# 4. Prove the DATA is there, not just the tables
psql "postgres://postgres:test@127.0.0.1:5433/postgres" -c \
  "select count(*) as users from users;
   select max(created_at) as newest_invoice from invoices;"
```

```text
 users
-------
  1847

    newest_invoice
------------------------
 2026-10-04 02:11:38+00
```

```bash
# 5. Point your app at it and open a page. This is the real test.
DATABASE_URL="postgres://postgres:test@127.0.0.1:5433/postgres" npm run start

# 6. Clean up
docker rm -f restore-test && rm -f /tmp/db*.
```

Write down two numbers while you do it:

- **How long did it take?** That is your recovery time, and it is the honest
  answer to "how long would we be down?"
- **How old was the backup?** That is your maximum data loss. A nightly backup
  means up to 24 hours of work can disappear.

If either number makes you uncomfortable, that is the signal to change
something — more frequent dumps, or a managed database with point-in-time
recovery. Database-side monitoring and the operations view of all this live in
[databases/operations/](../../databases/operations/README.md).

> **📌 Remember:** the drill is not about whether `pg_restore` works. It is
> about finding out, on a Tuesday afternoon, that your backups have been empty
> since August — instead of finding out during the worst hour of your year.

---

## Disk Space and Log Rotation

A full disk is the most common slow-motion outage there is. It is also the most
preventable, and the most total: PostgreSQL stops accepting writes, nginx cannot
write access logs, Docker cannot start containers, and you may not even be able
to log in to fix it.

It fills from four places, in roughly this order of likelihood:

```text
  /var/lib/docker   old images and build cache, from every deploy
  /var/log          journald, nginx access logs, your own log files
  /var/lib/postgres WAL files, plus bloat if autovacuum is struggling
  /var/backups      local dumps with no retention policy
```

The fixes are each one line, and you have already done two of them:

```bash
# Docker: cap container logs (done in 02-setting-up-the-server-part-1)
# Docker: prune old images weekly (done in deploy.sh)
docker image prune -af --filter "until=168h"

# journald: cap the system journal
sudo journalctl --vacuum-size=200M
sudo sed -i 's/^#SystemMaxUse=.*/SystemMaxUse=200M/' /etc/systemd/journald.conf
sudo systemctl restart systemd-journald

# nginx: logrotate already handles this on Ubuntu - confirm it is enabled
cat /etc/logrotate.d/nginx
```

```text
/var/log/nginx/*.log {
    daily
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 www-data adm
    sharedscripts
    postrotate
        [ -s /run/nginx.pid ] && kill -USR1 $(cat /run/nginx.pid)
    endscript
}
```

**Log rotation** means renaming the current log file, starting a fresh one, and
deleting old ones after N days. The `postrotate` part matters: nginx holds the
file open, so after the rename it must be told to reopen it, or it keeps writing
to a deleted file that still occupies disk space. This is why `df` can show a
full disk while `du` shows plenty free — the classic confusing symptom, explained
in [Logs, Disks and Debugging — Part 1](../01-linux-essentials/05-logs-disks-and-debugging-part-1.md).

Your application should not be writing log files at all. It writes JSON to
stdout, Docker captures it, and the cap you set controls the size. One moving
part instead of three.

Watch it, do not trust it:

```bash
df -h / && docker system df
```

```text
Filesystem      Size  Used Avail Use% Mounted on
/dev/vda1        78G   31G   44G  42% /

TYPE          TOTAL   ACTIVE   SIZE    RECLAIMABLE
Images           12        2   4.1GB   3.2GB (78%)
Build Cache     214        0   2.6GB   2.6GB
```

That `RECLAIMABLE` column is usually where the space went.

> **➡️ Continued in [Part 2](./04-keeping-it-running-part-2.md)** — patching,
> certificate renewal, the incident runbook, incident notes, when to leave this
> setup, and what it all costs.

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| Only monitoring from inside the server | When the box dies, the monitoring dies with it, and silence looks like health | An external checker is the first monitor you set up |
| A health endpoint that always returns 200 | Your monitor reports a dead app as healthy | Check the database and Redis, and return 503 when they fail |
| Alerting on CPU or memory percentages | They fire constantly and mean nothing on their own | Alert on symptoms users feel: errors, latency, downtime |
| Twenty alerts, so every one gets muted | The muted alert is the one that matters next time | Five alerts, each worth acting on |
| Backing up to the same disk as the database | Protects you from a `DROP TABLE` and nothing else | Copy it off the machine, every time |
| Never restoring a backup | Silent failures are the normal case, not the exception | A restore drill now, and once a quarter |
| Letting the app write its own log files | Rotation, disk and shipping all become your problem | JSON to stdout, cap it at the Docker level |
| Not monitoring that the backup ran | The job stops silently and you find out when you need it | A dead-man's-switch ping at the end of the script |

---

## Questions to Test Yourself

1. Your server loses power. Which of your monitors notices, and why would an
   internal-only setup report nothing at all?
2. Give the seven things worth watching on a small app, and name a distinct
   class of failure that each one catches.
3. Why is "5xx above 2% for 5 minutes" a better alert than "CPU above 70%"?
   Answer in terms of what you would do when each one fires.
4. You have nightly backups on the server's own disk. Name three disasters they
   protect against and three they do not.
5. During a restore drill the dump restores and the tables exist, but
   `select count(*) from users` returns 0. What probably went wrong?
6. Define your recovery time and maximum data loss from a nightly `pg_dump`
   taken at 02:00 if the database is destroyed at 17:00.
7. `df -h` says the disk is full but `du -sh /var/log` shows only 2 GB. What is
   happening, and which part of logrotate prevents it?
8. Your backup script has been failing for six weeks. Which single piece of this
   setup would have told you on day one?

---

## Related

- [04-keeping-it-running-part-2.md](04-keeping-it-running-part-2.md) — patching, the incident runbook, and when to outgrow this setup.
- [03-shipping-and-rollback-part-2.md](03-shipping-and-rollback-part-2.md) — the post-deploy checks that feed these same signals.
- [backend-fundamentals/08-logging-and-observability/04-metrics-and-health-checks-part-1.md](../../backend-fundamentals/08-logging-and-observability/04-metrics-and-health-checks-part-1.md) — metric types, percentiles, instrumenting Node.
- [backend-fundamentals/08-logging-and-observability/04-metrics-and-health-checks-part-2.md](../../backend-fundamentals/08-logging-and-observability/04-metrics-and-health-checks-part-2.md) — honest health endpoints and symptom-based alerting.
- [backend-fundamentals/12-files-and-integrations/02-object-storage-and-serving-files.md](../../backend-fundamentals/12-files-and-integrations/02-object-storage-and-serving-files.md) — why uploads do not belong on the VPS disk.
- [databases/operations/](../../databases/operations/README.md) — vacuum, bloat, replication and database-side monitoring.
- [databases/operations/05-monitoring-and-troubleshooting-part-1.md](../../databases/operations/05-monitoring-and-troubleshooting-part-1.md) — the queries behind database health.
- [01-linux-essentials/05-logs-disks-and-debugging-part-1.md](../01-linux-essentials/05-logs-disks-and-debugging-part-1.md) — journald, log rotation, `df` versus `du`, and the deleted file that freed nothing.
- [caching-and-background-jobs/03-background-jobs/07-operating-queues-part-1.md](../../caching-and-background-jobs/03-background-jobs/07-operating-queues-part-1.md) — queue metrics and why depth alone lies.
