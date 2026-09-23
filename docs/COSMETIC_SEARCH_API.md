# Cosmetic Search API

The desktop service uses `127.0.0.1` and `::1` and fetches Aurora data directly
with the user's configured Aurora key. Standalone deployments can explicitly set
`COSMETIC_SEARCH_BIND_HOST=0.0.0.0` (IPv4) or a specific IPv4/IPv6 address.
Launcher-owned services always stay on loopback and ignore that setting.
Configure authentication, firewall and TLS/reverse proxy before exposing a
standalone server. `YOUR_SERVER` examples below require that explicit server
deployment; they do not describe a publicly exposed desktop listener.

Standalone endpoint for exact cosmetic reverse-search using Aurora resource data.

## Run

```bash
mv cosmetic_search_package.json package.json
npm install
export AURORA_API_KEY="your_aurora_key"
export COSMETIC_SEARCH_TOKEN="optional_private_token"
export COSMETIC_SEARCH_PORT=3210
npm start
```

`AURORA_API_KEY` is required in standalone mode. Launcher-owned Fury reads its
configured Aurora key and applies key changes while the service is running.

## Search

GET:

```text
http://YOUR_SERVER:3210/api/cosmetics/search?bedDestroy=beddestroy_ghosts&finalKill=killeffect_blood_explosion&killMessage=killmessages_counter
```

POST:

```bash
curl -X POST "http://YOUR_SERVER:3210/api/cosmetics/search" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer optional_private_token" \
  -d '{
    "bedDestroy": "beddestroy_ghosts",
    "finalKill": "killeffect_blood_explosion",
    "killMessage": "killmessages_counter",
    "victoryDance": "victorydance_kartaway"
  }'
```

All provided fields are matched with AND logic. A player is returned only when every requested cosmetic field matches exactly.

## Special Values

Use these as normal values:

```text
activeSprays=null
activeBedDestroy=random_cosmetic
activeVictoryDance=random_favorite_cosmetic
```

`null` matches JSON null or missing fields.

`random` is shorthand for either `random_cosmetic` or `random_favorite_cosmetic`.

## Supported Fields

You can use the exact Aurora field names or friendly aliases.

```text
killMessage
activeVictoryDance / victoryDance
activeKillEffect / finalKill / killEffect
activeBedDestroy / bedDestroy
activeWoodType / woodSkin / wood
activeDeathCry / deathCry
activeProjectileTrail / projectileTrail
activeGlyph / glyph
activeIslandTopper / islandTopper
activeNPCSkin / npcSkin / shopkeeperSkin
activeSprays / sprays
active_figurine / figurine
```

## Utility

```text
GET /health
GET /api/cosmetics/fields
GET /api/cosmetics/refresh
```

The API caches Aurora data in memory and in `cosmetic_search_cache.json`.
