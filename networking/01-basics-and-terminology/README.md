# Basics & Terminology

The vocabulary networking is built on. Every later topic (TCP/IP, OSI,
protocols) just puts more precise rules around these same actors and
these same pieces of data.

## Table of Contents

1. [What "a Network" Actually Is](#what-a-network-actually-is)
2. [Host](#host)
3. [Client](#client)
4. [Server](#server)
5. [Client-Server Model](#client-server-model)
6. [Packet](#packet)
7. [Frame](#frame)
8. [Packet vs Frame](#packet-vs-frame)
9. [Quick Reference](#quick-reference)

---

## What "a Network" Actually Is

A network is just two or more devices connected so they can exchange
data. Your laptop talking to a Wi-Fi router, that router talking to your
ISP, your ISP talking to the rest of the internet — each hop is a
network, and the internet is the network of networks.

Data doesn't teleport between devices as one clean blob. It gets broken
into pieces, each piece gets wrapped with addressing information so it
knows where it came from and where it's going, and those pieces travel
independently, possibly over different paths, and get reassembled at the
other end. That's the core idea behind **packets** and **frames** below.

## Host

A **host** is any device on a network that can send or receive data —
a laptop, phone, server, printer, smart TV. "Host" is the general term;
whether that host is acting as a client or a server in a given
conversation depends on context, not on the device itself.

- Every host needs a unique address on the network (an **IP address**) to
  be reachable.
- A single physical device can be a client in one conversation and a
  server in another, at the same time (e.g., your laptop serves a local
  dev site to your phone while also being a client of google.com).

## Client

A **client** is the host that **initiates** a request. Your browser
asking for a webpage, your phone's Instagram app asking for your feed —
both are clients in that exchange.

- Clients don't have an inherent identity — they exist only relative to
  a server they're talking to.
- Examples: web browsers, mobile apps, `curl`, Postman, your terminal
  running `ping`.

## Server

A **server** is the host that **listens** for requests and **responds**
to them. It's usually always-on, waiting on a specific port for
incoming connections.

- A server is defined by the service it runs, not by being a special
  kind of hardware — a `$5/month` VPS running nginx is a "web server."
- One machine can run multiple servers (web server on port 80, database
  server on port 5432) — see [ports](../03-tcp-ip/) later.

## Client-Server Model

```
 CLIENT                                   SERVER
┌─────────┐   1. Request (GET /page)    ┌─────────┐
│ Browser │ ───────────────────────────▶│  nginx  │
│         │                             │         │
│         │◀─────────────────────────── │         │
└─────────┘   2. Response (HTML page)   └─────────┘
```

This request/response pattern is the foundation of the web (HTTP), and
of most application protocols covered later in
[Application Protocols](../06-application-protocols/). The alternative
model — peer-to-peer, where every host can be both client and server to
every other host — shows up in things like BitTorrent, but is far less
common for everyday internet use.

## Packet

A **packet** is a chunk of data prepared for transmission across a
network, at the **network layer** (Layer 3 — IP). Before your data
travels, it gets split into packets, and each packet is wrapped
("encapsulated") with a header containing:

- **Source IP address** — where it came from
- **Destination IP address** — where it's going
- Sequence info (so packets can be reassembled in the right order)

```
┌──────────────────┬─────────────────────────────┐
│   IP Header       │         Payload (data)      │
│ (src IP, dst IP)  │                              │
└──────────────────┴─────────────────────────────┘
```

Packets can take different physical routes to the same destination and
still get reassembled correctly — this is what makes routing (across
routers, across the internet) possible at all.

## Frame

A **frame** is the unit of data at the **data link layer** (Layer 2 —
Ethernet/Wi-Fi), one layer below packets. A frame wraps a packet with:

- **Source MAC address** — the physical hardware address of the sending
  network interface
- **Destination MAC address** — the physical hardware address of the
  next hop (not necessarily the final destination — often the next
  router along the way)
- A trailer for error checking (CRC/FCS)

```
┌───────────────────┬──────────────────────────────────┬────────┐
│   Frame Header      │           Packet (IP)              │ Trailer│
│ (src MAC, dst MAC)  │  (src IP, dst IP + payload)         │ (CRC)  │
└───────────────────┴──────────────────────────────────┴────────┘
```

A frame only ever travels across **one physical link** (e.g., your
laptop to your Wi-Fi router). When that packet needs to cross to the
next link (router to router), it gets re-wrapped in a **new frame** with
new MAC addresses — but the packet inside, and its IP addresses, stay
the same all the way to the destination. This is the core mechanic
behind routing and will come back in detail in
[OSI Model](../04-osi-model/).

## Packet vs Frame

| | Packet | Frame |
|---|---|---|
| OSI Layer | Layer 3 (Network) | Layer 2 (Data Link) |
| Addressing | IP addresses (logical) | MAC addresses (physical) |
| Scope | End-to-end (source host → destination host) | One hop (one physical link) |
| Changes en route? | IP addresses stay the same | MAC addresses change at every hop |
| Analogy | The letter and envelope with the final address | The delivery truck's routing label for the next depot |

## Quick Reference

| Term | One-line definition |
|---|---|
| Host | Any addressable device on a network |
| Client | The host that initiates a request |
| Server | The host that listens and responds |
| Packet | Layer 3 unit of data, addressed by IP, travels end-to-end |
| Frame | Layer 2 unit of data, addressed by MAC, travels one hop |
