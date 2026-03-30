---
name: polymarket-hedge-agent
description: Use when matching user preferences to indexed Polymarket markets, fetching Polymarket market data, and persisting hedge links in eddie-server.
---

# Polymarket Hedge Agent

Use this skill when the task is to inspect user preferences, inspect indexed Polymarket markets, find markets that move against a user's stated preference, and save those hedge links back to this backend.

## Local Backend Endpoints

- `GET /polymarket/markets`
  Returns indexed markets already stored in this backend. Prefer markets where `active=true`, `acceptingOrders=true`, and `closed=false`.

- `GET /user/preferences/batch?clerkUserId=<id>`
  Returns both `preferences` and `preferenceRecords`. Use `preferenceRecords` when you need the local `userPreferenceId`.

- `GET /market/preferences?clerkUserId=<id>`
  Returns existing persisted hedge links for the user. Read this before creating new links so you do not create duplicate records for the same `userPreferenceId + polymarketMarketId` pair.

- `POST /polymarket/index`
  Body: `{ "market": "<slug-or-polymarket-url>" }`
  Use this only when the target market is not already indexed locally. This endpoint requires the `x-polymarket-test-secret` header because it fetches and persists the indexed market.

- `POST /market/preferences`
  Body:
  ```json
  {
    "userPreferenceId": 123,
    "polymarketMarketId": 456,
    "rank": 1,
    "rationale": "Why this market offsets the preference.",
    "hedgeOutcome": "NO",
    "hedgeTokenId": "1234567890",
    "hedgeSide": "BUY"
  }
  ```

- `PUT /market/preferences/:id`
  Update `rank`, `rationale`, and optionally the full hedge selection (`hedgeOutcome`, `hedgeTokenId`, `hedgeSide`) together.

## External Polymarket GET Endpoints

- Discovery
  [Search markets, events, and profiles](https://docs.polymarket.com/api-reference/search/search-markets-events-and-profiles)
  [List markets](https://docs.polymarket.com/api-reference/markets/list-markets)
  [Get market by slug](https://docs.polymarket.com/api-reference/markets/get-market-by-slug)
  [List events](https://docs.polymarket.com/api-reference/events/list-events)

- Sports normalization
  [Get sports metadata information](https://docs.polymarket.com/api-reference/sports/get-sports-metadata-information)
  [List teams](https://docs.polymarket.com/api-reference/sports/list-teams)

- Liquidity and pricing checks
  [Get order book](https://docs.polymarket.com/api-reference/market-data/get-order-book)
  [Get market price](https://docs.polymarket.com/api-reference/market-data/get-market-price)
  [Get spread](https://docs.polymarket.com/api-reference/market-data/get-spread)

- Optional confidence signals
  [Get open interest](https://docs.polymarket.com/api-reference/misc/get-open-interest)
  [Get top holders for markets](https://docs.polymarket.com/api-reference/core/get-top-holders-for-markets)
  [Get trades for a user or markets](https://docs.polymarket.com/api-reference/core/get-trades-for-a-user-or-markets)

Polymarket splits reads across Gamma, CLOB, and Data APIs. Keep the docs overview handy:
[Overview](https://docs.polymarket.com/developers/misc-endpoints/data-api-activity)

## Workflow

1. Load indexed local markets with `GET /polymarket/markets`.
2. Load all user preferences with `GET /user/preferences/batch`.
3. Load existing saved links with `GET /market/preferences`.
4. Skip any preference where `marketPreferenceEligible` is `false`.
5. Look for a market whose outcome is adverse to the user's preference.
6. If the market is not indexed locally, call `POST /polymarket/index` first.
7. Persist the link with `POST /market/preferences`, or update the existing link with `PUT /market/preferences/:id`.

## Hedge Rules

- Save the adverse leg, not the favored leg.
- Default to `hedgeSide: "BUY"` on the adverse outcome token.
- Use `rank=1` for the best hedge and larger ranks for weaker alternatives.
- Only persist a link when the rationale explicitly explains how the market offsets the preference.
- Do not create placeholder links when no hedge is available.
- Treat records with `hedgeOutcome`, `hedgeTokenId`, or `hedgeSide` set to `null` as legacy records that should be updated before they are used for action.

## Selection Heuristics

- Prefer indexed markets before searching externally.
- Prefer markets with tighter spreads and visible order-book depth.
- Prefer simpler mappings. Example: if the user likes Team A and the market is "Will Team A win?", hedge with the adverse outcome such as `NO`.
- If the market structure does not provide a clear adverse outcome, skip it instead of inventing a weak hedge.
