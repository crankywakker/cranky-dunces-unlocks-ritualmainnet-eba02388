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

/**
 * Looks up the Dunce token already owned by `address` via the DunceMinted
 * event log, then fetches its IPFS metadata for handle + image.
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
        const logs = await publicClient.getLogs({
          address: DUNCES_ADDRESS,
          event: eventAbi as never,
          args: { minter: address },
          fromBlock: 0n,
          toBlock: "latest",
        });
        if (cancelled) return;
        if (logs.length === 0) {
          setData(null);
          return;
        }
        const log = logs[0] as unknown as {
          args: { tokenId: bigint; tokenURI: string };
          transactionHash: `0x${string}`;
        };
        const tokenId = log.args.tokenId;
        const tokenURI = log.args.tokenURI;
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
          txHash: log.transactionHash,
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
