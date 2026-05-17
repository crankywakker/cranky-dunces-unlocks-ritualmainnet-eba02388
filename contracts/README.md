# The Great Dunce's of Ritual — Contracts

> 666 free mints to unlock Ritual Mainnet.
> Protocol designed by **crankywakker**.

ERC-721 (`ERC721URIStorage`) on **Ritual Chain** (chainId `1979`).

```
User → Frontend → /api/pin-metadata ─┬─► Twitter API v2  (resolve PFP)
                                     ├─► Pinata          (pin image)
                                     └─► Pinata          (pin JSON: name "Dunce #N",
                                                          image, attributes incl.
                                                          { Creator: crankywakker })
                                            │
                                            ▼
                              ipfs://<jsonCid> returned to client
                                            │
                                            ▼
                  GreatDuncesOfRitual.mintDunce(ipfs://<jsonCid>)  ──►  Ritual Chain
```

## Network

| Field    | Value                                      |
| -------- | ------------------------------------------ |
| Name     | RitualChain                                |
| Chain ID | `1979`                                     |
| RPC      | `https://rpc.ritualfoundation.org`         |
| Symbol   | `RITUAL`                                   |
| Explorer | `https://explorer.ritualfoundation.org`    |
| Faucet   | `https://faucet.ritualfoundation.org`      |

## Setup

```bash
cd contracts
npm install            # or: bun install
cp .env.example .env   # fill PRIVATE_KEY (+ TWITTER_BEARER_TOKEN, PINATA_JWT for the metadata script)
npm run compile
npm test
```

## Deploy

```bash
npm run deploy         # → Ritual Chain (1979), auto-verifies on the explorer
```

After deploy, copy the printed address into your frontend's wagmi config.

## Mint flow (server-side helper)

`scripts/pin-metadata.ts` assembles & pins each token's metadata. Call it from
your backend on every mint request, then hand the returned `ipfs://CID` URI to
the frontend, which calls `mintDunce(uri)`.

```bash
bun run scripts/pin-metadata.ts crankywakker 1 0xYourMinter…
# → ipfs://bafkre…
```

The pinned JSON always contains:

```json
{
  "name": "Dunce #N",
  "image": "ipfs://<imageCid>",
  "attributes": [
    { "trait_type": "Creator", "value": "crankywakker" },
    { "trait_type": "Edition", "value": N, "max_value": 666 }
  ]
}
```

## Contract guarantees

- `MAX_SUPPLY = 666`, IDs strictly `1..666`.
- `hasMinted[wallet]` → **1 mint per wallet**, enforced atomically.
- Free mint — caller pays gas only.
- Reentrancy-guarded; state mutated **before** `_safeMint`.
- Custom errors (`SoldOut`, `AlreadyMinted`, `EmptyURI`) for cheap reverts.
- Race condition between two concurrent minters is resolved by EVM ordering —
  the second tx reverts with `SoldOut` or `AlreadyMinted`; the frontend should
  catch the revert and refresh `totalSupply`.

## Edge-case behavior

| Scenario                             | Behavior                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------- |
| Twitter handle 404 / private / banned| `resolveTwitterPfp()` returns the fallback Dunce image; mint still succeeds.                |
| Pinata down                          | `assembleMetadata()` throws; surface to user, no on-chain state changed.                    |
| Two wallets mint last token at once  | Second tx reverts `SoldOut`; frontend re-reads `totalSupply()` and shows sold-out UI.       |
| Same wallet double-clicks mint       | Second tx reverts `AlreadyMinted`; UI catches revert and shows "Limit 1 per wallet".        |
| RPC throttled                        | Configure fallback RPCs in the frontend wagmi `transports` array (HTTP → HTTP fallback).    |
