# Nginx Reverse Proxy Configuration

[reverse-proxy.md](../../system-design/foundational/reverse-proxy.md)
covers the general concept — a server that forwards client requests to a
backend and returns the response as its own. This page is the concrete
Nginx configuration for doing that correctly: the headers real
applications need, the details that are easy to get wrong (WebSockets,
timeouts, body size), and how it composes with TLS termination.

## Table of Contents

1. [The Minimum Viable Config](#the-minimum-viable-config)
2. [Headers the Backend Actually Needs](#headers-the-backend-actually-needs)
3. [Timeouts](#timeouts)
4. [WebSocket Support](#websocket-support)
5. [Path-Based Routing to Multiple Services](#path-based-routing-to-multiple-services)
6. [TLS Termination in Front of a Proxy](#tls-termination-in-front-of-a-proxy)
7. [Buffering](#buffering)
8. [Quick Reference](#quick-reference)

---

## The Minimum Viable Config

```nginx
server {
    listen 80;
    server_name api.example.com;

    location / {
        proxy_pass http://127.0.0.1:8000;
    }
}
```

This works for a basic request/response cycle, but it's missing headers
most real applications need to function correctly — the next section
covers why.

## Headers the Backend Actually Needs

By default, the backend sees the proxy's own IP and hostname as the
request's origin — not the real client's. Without corrective headers,
application logs, rate limiting, and geo-based logic all see the wrong
information:

```nginx
location / {
    proxy_pass http://127.0.0.1:8000;

    proxy_set_header Host $host;                       # preserve the original Host header
    proxy_set_header X-Real-IP $remote_addr;             # the actual client's IP
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;  # chain of proxies, if any
    proxy_set_header X-Forwarded-Proto $scheme;           # was the original request http or https?
}
```

```python
# Backend code needs to read X-Forwarded-For / X-Real-IP explicitly —
# request.remote_addr alone would show the proxy's IP, not the client's
client_ip = request.headers.get("X-Real-IP", request.remote_addr)
```

**`X-Forwarded-Proto` matters specifically when Nginx terminates TLS**
(see below) — the backend receives a plain HTTP request either way, and
without this header it has no way to know the original request was
actually HTTPS (relevant for generating correct absolute URLs, or
redirect logic that should force HTTPS).

## Timeouts

Without explicit timeouts, a slow or hung backend can leave a proxied
connection open indefinitely, tying up resources on both sides:

```nginx
location / {
    proxy_pass http://127.0.0.1:8000;

    proxy_connect_timeout 5s;    # max time to establish the connection to the backend
    proxy_send_timeout 30s;       # max time to send the request to the backend
    proxy_read_timeout 30s;        # max time to wait for the backend's response
}
```

Set these based on the backend's actual expected response time — too
short and legitimately slow-but-valid requests (a large report query) get
cut off; too long and a hung backend holds connections open far longer
than necessary, worsening any ongoing incident instead of failing fast
(see [circuit-breakers-and-retries.md](../../system-design/reliability/circuit-breakers-and-retries.md)
for the broader principle of not waiting forever on a struggling
dependency).

## WebSocket Support

A plain `proxy_pass` doesn't automatically upgrade a connection to a
WebSocket — it needs explicit header forwarding for the HTTP Upgrade
handshake to pass through correctly:

```nginx
location /ws/ {
    proxy_pass http://127.0.0.1:8000;

    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";

    proxy_read_timeout 3600s;    # WebSocket connections are long-lived —
                                   # the default read timeout would kill them
}
```

Without `Upgrade`/`Connection` forwarded, the backend never sees the
handshake as a WebSocket upgrade request — the connection either fails
outright or silently falls back to plain HTTP behavior, which is a
common, confusing bug when adding WebSocket support behind an existing
proxy config.

## Path-Based Routing to Multiple Services

The same pattern from the general
[reverse-proxy concept doc](../../system-design/foundational/reverse-proxy.md#request-routing),
concretely in Nginx — routing different paths to entirely different
backend services:

```nginx
server {
    listen 80;
    server_name example.com;

    location /api/orders/ {
        proxy_pass http://orders-service:8000/;
    }

    location /api/users/ {
        proxy_pass http://users-service:8000/;
    }

    location / {
        proxy_pass http://frontend-service:3000/;
    }
}
```

**The trailing slash on `proxy_pass` matters** — `proxy_pass
http://orders-service:8000/;` (with trailing slash) strips the matched
`location` prefix before forwarding; omitting it forwards the full
original path unchanged. Getting this backward is a very common source
of "why is my backend receiving the wrong path" bugs.

## TLS Termination in Front of a Proxy

Combining TLS termination (see the general concept in
[reverse-proxy.md](../../system-design/foundational/reverse-proxy.md#tls-termination))
with proxying — Nginx decrypts HTTPS from the client, then talks plain
HTTP to the backend:

```nginx
server {
    listen 443 ssl;
    server_name api.example.com;

    ssl_certificate     /etc/letsencrypt/live/api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header X-Forwarded-Proto https;   # tell the backend the original request was HTTPS
    }
}

server {
    listen 80;
    server_name api.example.com;
    return 301 https://$host$request_uri;   # redirect all plain HTTP to HTTPS
}
```

## Buffering

By default, Nginx buffers the backend's full response before sending it
to the client — usually desirable (it frees the backend connection up
faster, letting Nginx handle the potentially-slow client transfer
independently), but can add latency for streaming responses that should
reach the client incrementally:

```nginx
location /stream/ {
    proxy_pass http://127.0.0.1:8000;
    proxy_buffering off;    # pass through immediately, no batching —
                              # necessary for server-sent events / streaming responses
}
```

Leave buffering on for typical request/response APIs; turn it off
specifically for endpoints doing chunked/streaming responses where
buffering would introduce visible lag.

---

## Quick Reference

| Problem                                                | Fix                                                        |
| :------------------------------------------------------------ | :----------------------------------------------------------------- |
| Backend sees the proxy's IP instead of the real client's          | `proxy_set_header X-Real-IP $remote_addr;`                             |
| Backend doesn't know the original request was HTTPS                | `proxy_set_header X-Forwarded-Proto $scheme;` (or hardcode `https`)      |
| Slow backend holds connections open indefinitely                   | `proxy_connect_timeout` / `proxy_read_timeout`                          |
| WebSocket connection fails or silently degrades                    | Forward `Upgrade` and `Connection: upgrade` headers                       |
| Wrong path reaching the backend after routing                      | Check the trailing slash on `proxy_pass`                                   |
| Streaming response arrives with unwanted delay                     | `proxy_buffering off;` for that specific location                          |

**Bottom line:** a working `proxy_pass` is the easy 10% — correctly
forwarding client identity (`X-Real-IP`, `X-Forwarded-*`), setting
sane timeouts, and handling WebSocket upgrades explicitly are what
separate a demo config from one that survives real production traffic.
