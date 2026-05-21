import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import type { Address } from "viem";
import { DUNCES_ABI, DUNCES_ADDRESS, IS_CONTRACT_CONFIGURED } from "./contract";

export type OwnedDunce = {
  tokenId: bigint;
  handle: string;
  imageUrl: string;
  txHash: `0x${string}` | null;
};

function ipfsToGateway(uri: string): string {
  if (uri.startsWith("ipfs://"))
    return `https://gateway.pinata.cloud/ipfs/${uri.slice("ipfs://".length)}`;
  return uri;
}

// Ritual RPC caps eth_getLogs at 100k blocks per request.
const LOG_CHUNK = 99_000n;

// Optional: set VITE_DUNCES_DEPLOY_BLOCK to the contract's deployment block to
// short-circuit the backward scan. Falls back to 0 (best-effort) when unset.
const DEPLOY_BLOCK_RAW = (import.meta.env.VITE_DUNCES_DEPLOY_BLOCK ?? "").trim();
const DEPLOY_BLOCK: bigint = /^\d+$/.test(DEPLOY_BLOCK_RAW)
  ? BigInt(DEPLOY_BLOCK_RAW)
  : 0n;

/**
 * Looks up the Dunce token already owned by `address` via the DunceMinted
 * event log, then fetches its IPFS metadata for handle + image.
 *
 * The hook is gated by the caller on `hasMinted(address)` so we only run
 * when we already know a token exists. We scan event logs in ≤100k-block
 * chunks (Ritual RPC limit) walking backwards from the latest block.
 */
export function useOwnedDunce(address: Address | undefined, enabled: boolean) {
  const publicClient = usePublicClient();
  const [data, setData] = useState<OwnedDunce | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !address || !publicClient || !IS_CONTRACT_CONFIGURED) {
      setData(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);

        const eventAbi = DUNCES_ABI.find(
          (i) => i.type === "event" && i.name === "DunceMinted",
        );

        const latest = await publicClient.getBlockNumber();
        let toBlock = latest;
        type MintLog = {
          args: { tokenId: bigint; tokenURI: string };
          transactionHash: `0x${string}`;
        };
        let found: MintLog | null = null;

        // Walk backwards in 99k-block windows until we find the mint or hit DEPLOY_BLOCK.
        while (!cancelled && toBlock >= DEPLOY_BLOCK) {
          const fromBlock =
            toBlock > LOG_CHUNK + DEPLOY_BLOCK
              ? toBlock - LOG_CHUNK
              : DEPLOY_BLOCK;
          const logs = await publicClient.getLogs({
            address: DUNCES_ADDRESS,
            event: eventAbi as never,
            args: { minter: address } as never,
            fromBlock,
            toBlock,
          });
          if (logs.length > 0) {
            found = logs[0] as unknown as MintLog;
            break;
          }
          if (fromBlock === DEPLOY_BLOCK) break;
          toBlock = fromBlock - 1n;
        }
        if (cancelled) return;
        if (!found) {
          setData(null);
          return;
        }

        const tokenId = found.args.tokenId;
        const tokenURI = found.args.tokenURI;
        const metaUrl = ipfsToGateway(tokenURI);
        const res = await fetch(metaUrl);
        if (!res.ok) throw new Error(`Metadata fetch failed (${res.status})`);
        const meta = (await res.json()) as {
          image?: string;
          attributes?: Array<{ trait_type?: string; value?: unknown }>;
        };
        const handleAttr = meta.attributes?.find(
          (a) => a.trait_type === "Twitter Handle",
        );
        const handle = String(handleAttr?.value ?? "");
        const imageUrl = ipfsToGateway(meta.image ?? "");
        if (cancelled) return;
        setData({
          tokenId,
          handle,
          imageUrl,
          txHash: found.transactionHash,
        });
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address, enabled, publicClient]);

  return { data, loading, error };
}
