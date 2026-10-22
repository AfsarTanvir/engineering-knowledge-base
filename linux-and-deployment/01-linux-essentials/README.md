# Part 1 — Linux Essentials

You SSH into a server for the first time. There is a `$` and nothing else. Your
app is somewhere on this machine, it is supposed to be listening on a port, and
it is not answering. Every tool you need is already installed, and you do not
know the name of a single one.

This part fixes that. It is the vocabulary everything later assumes: what a
shell is, what a process is, what a port is, who owns a file, and where the logs
went. Linux is not covered anywhere else in this repo, so nothing here is
assumed. **Open a terminal and type along** — reading `ls` output is the skill,
and you cannot read it by reading about it.

> **📌 The whole part in one line:** a server is a machine running your process
> as some user, listening on some address, writing to some log — and every
> deployment problem is one of those four sentences being wrong.

## Files

1. [The Shell and the Filesystem — Part 1](01-the-shell-and-filesystem-part-1.md)
   — what a shell really is, one tree from `/`, paths, and reading `ls -lah`.
2. [Part 2](01-the-shell-and-filesystem-part-2.md) — pipes, redirection, exit
   codes, `nano` and `vim`, globs versus regex, quoting.
3. [Processes and Services — Part 1](02-processes-and-services-part-1.md) —
   PIDs, `ps`, `top`, signals, and why your server died when you closed SSH.
4. [Part 2](02-processes-and-services-part-2.md) — systemd unit files, crash
   loops, pm2 versus systemd, OOM kills, PID 1 in a container.
5. [Users, Permissions and SSH — Part 1](03-users-permissions-and-ssh-part-1.md)
   — users, `sudo`, `rwx`, numeric modes, and the log directory bug.
6. [Part 2](03-users-permissions-and-ssh-part-2.md) — SSH keys, `rsync`,
   `~/.ssh/config`, hardening a server, and tunnels to a private database.
7. [Networking, Ports and Firewalls — Part 1](04-networking-ports-and-firewalls-part-1.md)
   — `localhost` versus `0.0.0.0`, `ss -tulpn`, and the troubleshooting ladder.
8. [Part 2](04-networking-ports-and-firewalls-part-2.md) — `curl` in depth,
   `ufw`, locking yourself out, and cloud security groups.
9. [Logs, Disks and Debugging — Part 1](05-logs-disks-and-debugging-part-1.md) —
   `journalctl`, `jq`, log rotation, and a full disk that frees nothing.
10. [Part 2](05-logs-disks-and-debugging-part-2.md) — memory, load average, the
    triage runbook, environment variables, and why servers run UTC.

## Read in this order

Read 1 → 10 in order, one file per sitting. Files 1 and 2 are the vocabulary
every later file uses. Files 3 and 4 are one idea: a process needs a parent that
outlives your session. Files 9 and 10 are what you will actually reach for
during an incident — read them before your first outage, not during it.

## What you should be able to do after this part

- Read `ls -lah`, `ps aux`, `ss -tulpn` and `systemctl status` and say what the
  machine is doing.
- Write a systemd unit for a Node app that runs as the right user and restarts
  on failure.
- Diagnose "permission denied" by who the process is, not by trying `777`.
- Say why something works on `localhost` but not from outside, and prove it.
- Find the full disk, the 17 GB log, and the process still holding it open.
- Work the triage runbook from "the app is down" to a named cause.

## Where this connects

- **Concepts, not repeated:** HTTP and ports in
  [01-http-foundations/](../../backend-fundamentals/01-http-foundations/), the
  protocol stack in [networking/](../../networking/).
- **Your app's side of these problems:** graceful shutdown in
  [03-request-lifecycle/](../../backend-fundamentals/03-request-lifecycle/) and
  [03-background-jobs/](../../caching-and-background-jobs/03-background-jobs/),
  structured logs in
  [08-logging-and-observability/](../../backend-fundamentals/08-logging-and-observability/),
  configuration in
  [11-api-security/](../../backend-fundamentals/11-api-security/).
- **The database runbook this one hands over to:**
  [databases/operations/](../../databases/operations/).

## Next

Part 2 — [Docker in Practice](../02-docker-in-practice/) packages the app whose
process, user, port and logs you can now read.
