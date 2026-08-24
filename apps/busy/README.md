# @ayrock/busy

An API powering a custom [Busy Bar](https://busy.app/) integration.

## Stack

- [Hono](https://hono.dev/) API
- Deployed on [Cloudflare Workers](https://workers.cloudflare.com/)
- [`zod/v4/mini`](https://zod.dev/) for schema validation
- [PlanetScale Postgres](https://planetscale.com/postgres) for managed persistent storage
- [Upstash QStash](https://upstash.com/docs/qstash) for managed queueing and workflows

## Quickstart

```sh
pnpm run dev -f @ayrock/busy
```
