# Nginx

Nginx is one of the most widely deployed web servers and reverse proxies
in production — fast, low-memory, and built around an event-driven
architecture that handles many concurrent connections without spawning a
thread per request. It shows up in three overlapping roles: serving
static files directly, reverse-proxying to application servers (covered
in depth in [reverse-proxy-config.md](reverse-proxy-config.md)), and
load balancing across multiple backend instances.

## Table of Contents

1. [Why Nginx Handles Concurrency Well](#why-nginx-handles-concurrency-well)
2. [Config File Structure](#config-file-structure)
3. [Serving Static Files](#serving-static-files)
4. [Basic Reverse Proxying](#basic-reverse-proxying)
5. [Load Balancing Across Backends](#load-balancing-across-backends)
6. [Common Directives Cheat Sheet](#common-directives-cheat-sheet)
7. [Testing and Reloading Config](#testing-and-reloading-config)
8. [Quick Reference](#quick-reference)

---

## Why Nginx Handles Concurrency Well

Many older web servers (traditional Apache configurations) spawn a
process or thread per connection — memory and context-switching overhead
that scales linearly with concurrent connections. Nginx uses a small
number of worker processes, each handling many connections
asynchronously via an event loop — connections that are idle (waiting on
a slow client, or waiting on a backend response) don't tie up a whole
thread doing nothing.

```
Traditional (process/thread-per-connection):
  10,000 connections -> 10,000 threads -> significant memory/CPU overhead

Nginx (event-driven, worker processes):
  10,000 connections -> handled by a handful of worker processes,
  each managing thousands of connections concurrently via non-blocking I/O
```

This is why Nginx is a common choice specifically for the reverse-proxy/
load-balancer layer, which needs to hold open many client connections
simultaneously while waiting on backend responses.

## Config File Structure

```nginx
# /etc/nginx/nginx.conf (simplified structure)
events {
    worker_connections 1024;      # max connections per worker process
}

http {
    include /etc/nginx/conf.d/*.conf;    # commonly split per-site configs here

    server {
        listen 80;
        server_name example.com;

        location / {
            root /var/www/html;
        }
    }
}
```

- **`http` block** — global settings for handling HTTP traffic
- **`server` block** — one virtual host (a site/domain); a single Nginx
  instance can serve many `server` blocks, routed by `server_name` or
  port
- **`location` block** — routes within a server, matched by path

## Serving Static Files

Nginx's original core use case — directly serving files from disk,
extremely efficiently, without invoking any application code:

```nginx
server {
    listen 80;
    server_name example.com;
    root /var/www/html;

    location / {
        try_files $uri $uri/ /index.html;   # for SPAs: fall back to index.html
    }

    location /static/ {
        expires 1y;                          # long browser cache — see CDN doc for the concept
        add_header Cache-Control "public, immutable";
    }
}
```

This directly implements the `Cache-Control` guidance from
[cdn-and-edge-caching.md](../../system-design/scale-patterns/cdn-and-edge-caching.md) —
Nginx is frequently the thing actually setting those headers at the
origin, even when a CDN sits in front of it.

## Basic Reverse Proxying

Forwarding requests to an application server running elsewhere — see
[reverse-proxy-config.md](reverse-proxy-config.md) for the full detail
on headers, WebSockets, and timeouts:

```nginx
server {
    listen 80;
    server_name api.example.com;

    location / {
        proxy_pass http://127.0.0.1:8000;    # forward to the app server
    }
}
```

## Load Balancing Across Backends

An `upstream` block groups multiple backend addresses; `proxy_pass`
points at the group instead of a single address, and Nginx distributes
requests across them (see
[load-balancing.md](../../system-design/foundational/load-balancing.md)
for the algorithms themselves):

```nginx
upstream backend_pool {
    server 10.0.0.1:8000;
    server 10.0.0.2:8000;
    server 10.0.0.3:8000;
}

server {
    listen 80;
    location / {
        proxy_pass http://backend_pool;
    }
}
```

```nginx
upstream backend_pool {
    least_conn;                    # switch from default round-robin
    server 10.0.0.1:8000 weight=3;   # weighted — gets 3x the traffic of the others
    server 10.0.0.2:8000;
    server 10.0.0.3:8000 down;       # temporarily remove from rotation without deleting the line
}
```

## Common Directives Cheat Sheet

```nginx
listen 80;                          # port to listen on
server_name example.com;             # which Host header this server block handles
root /var/www/html;                   # filesystem path for static files
index index.html;                      # default file to serve for a directory request
return 301 https://$host$request_uri;   # redirect, e.g. HTTP -> HTTPS
gzip on;                                 # compress responses
client_max_body_size 10M;                 # cap request body size (see reverse-proxy-config.md)
```

## Testing and Reloading Config

Nginx can validate a config file without actually applying it — always
do this before reloading, since a syntax error in a config change can
otherwise take the server down mid-reload:

```bash
nginx -t              # test config syntax, reports errors without applying
nginx -s reload         # reload config gracefully (no dropped connections)
systemctl reload nginx   # equivalent, via systemd
```

`reload` (not `restart`) is what allows config changes to take effect
without dropping currently-open connections — existing connections
finish against the old config while new connections pick up the new one.

---

## Quick Reference

| Need                                                | Directive / block                            |
| :---------------------------------------------------------- | :--------------------------------------------------- |
| Serve static files from disk                                  | `root`, `location`                                       |
| Forward requests to an application server                      | `proxy_pass` — see [reverse-proxy-config.md](reverse-proxy-config.md) |
| Distribute requests across multiple backend instances            | `upstream` block + `proxy_pass http://<upstream_name>;`     |
| Change the load-balancing algorithm                             | `least_conn;` / `ip_hash;` inside the `upstream` block         |
| Apply a config change without dropping connections               | `nginx -t && nginx -s reload`                                  |

**Bottom line:** Nginx's event-driven model is what lets it hold open
thousands of concurrent connections cheaply — the same property that
makes it a natural fit for the reverse-proxy and load-balancer layer in
front of an application, not just a static file server.
