import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useReadContract,
  useSwitchChain,
  useWriteContract,
  useWaitForTransactionReceipt,
  useChainId,
} from "wagmi";
import { toast } from "sonner";
import { ClientOnly } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  DUNCES_ABI,
  DUNCES_ADDRESS,
  IS_CONTRACT_CONFIGURED,
  MAX_SUPPLY,
} from "@/lib/contract";
import { ritualChain } from "@/lib/wagmi";
import { pinMintMetadata } from "@/lib/pin-metadata.functions";
import { getTwitterPfp } from "@/lib/twitter-pfp.functions";
import { Download, ExternalLink, Loader2, Twitter, Wallet } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <BackgroundAura />
      <Header />
      <section className="mx-auto flex max-w-5xl flex-col items-center gap-10 px-6 pb-24 pt-16 md:pt-24">
        <Hero />
        <ClientOnly fallback={<MintCardSkeleton />}>
          <MintCard />
        </ClientOnly>
        <Footer />
      </section>
    </main>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function BackgroundAura() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div
        className="absolute -top-40 left-1/2 h-[40rem] w-[40rem] -translate-x-1/2 rounded-full opacity-40 blur-3xl"
        style={{ background: "var(--gradient-ritual)" }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,transparent_40%,var(--ritual-obsidian)_85%)]" />
    </div>
  );
}

function Header() {
  return (
    <header className="relative z-10 mx-auto flex w-full max-w-5xl items-center justify-between px-6 pt-6">
      <div className="flex items-center gap-2">
        <div
          className="h-8 w-8 rounded-md"
          style={{ background: "var(--gradient-ritual)" }}
        />
        <span className="font-mono text-sm uppercase tracking-[0.2em] text-muted-foreground">
          Ritual&nbsp;/&nbsp;Dunces
        </span>
      </div>
      <ClientOnly fallback={null}>
        <ConnectButton />
      </ClientOnly>
    </header>
  );
}

function Hero() {
  return (
    <div className="relative z-10 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.4em] text-accent">
        666 free mints to unlock Ritual Mainnet
      </p>
      <h1 className="mt-4 text-5xl font-bold tracking-tight md:text-7xl">
        The Great{" "}
        <span
          className="bg-clip-text text-transparent"
          style={{ backgroundImage: "var(--gradient-ritual)" }}
        >
          Dunce's
        </span>{" "}
        of Ritual
      </h1>
      <p className="mx-auto mt-5 max-w-xl text-base text-muted-foreground md:text-lg">
        Mint your Dunce with your own Twitter PFP. One per wallet. Free —
        you only pay gas. Designed by{" "}
        <a
          href="https://twitter.com/crankywakker"
          target="_blank"
          rel="noreferrer"
          className="text-accent underline-offset-4 hover:underline"
        >
          crankywakker
        </a>
        .
      </p>
    </div>
  );
}

function Footer() {
  return (
    <p className="relative z-10 text-center font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground/70">
      Ritual Chain · 1979 · explorer.ritualfoundation.org
    </p>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (!isConnected) {
    const injected = connectors[0];
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={isPending || !injected}
        onClick={() => injected && connect({ connector: injected })}
      >
        <Wallet className="mr-2 h-4 w-4" />
        {isPending ? "Connecting…" : "Connect wallet"}
      </Button>
    );
  }

  return (
    <Button variant="outline" size="sm" onClick={() => disconnect()}>
      <Wallet className="mr-2 h-4 w-4" />
      {address?.slice(0, 6)}…{address?.slice(-4)}
    </Button>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function MintCardSkeleton() {
  return (
    <Card className="w-full max-w-xl">
      <CardContent className="p-8">
        <div className="h-40 animate-pulse rounded-md bg-muted" />
      </CardContent>
    </Card>
  );
}

function MintCard() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const wrongChain = isConnected && chainId !== ritualChain.id;

  const [handle, setHandle] = useState("");
  const [pinning, setPinning] = useState(false);
  const [mintedTokenId, setMintedTokenId] = useState<bigint | null>(null);
  const [mintedImageUrl, setMintedImageUrl] = useState<string | null>(null);

  const supplyQ = useReadContract({
    address: DUNCES_ADDRESS,
    abi: DUNCES_ABI,
    functionName: "totalSupply",
    query: { enabled: IS_CONTRACT_CONFIGURED, refetchInterval: 12_000 },
  });
  const minted = supplyQ.data ?? 0n;
  const remaining = MAX_SUPPLY - minted;
  const soldOut = remaining <= 0n;
  const progressPct = Number((minted * 1000n) / MAX_SUPPLY) / 10;

  const hasMintedQ = useReadContract({
    address: DUNCES_ADDRESS,
    abi: DUNCES_ABI,
    functionName: "hasMinted",
    args: address ? [address] : undefined,
    query: { enabled: IS_CONTRACT_CONFIGURED && !!address },
  });
  const alreadyMinted = hasMintedQ.data === true;

  const { writeContractAsync, data: txHash, isPending: writing } =
    useWriteContract();
  const { isLoading: confirming, isSuccess: confirmed } =
    useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (confirmed) {
      const newId = (minted ?? 0n) + 0n; // we re-read below
      toast.success("Dunce minted ☉");
      supplyQ.refetch();
      hasMintedQ.refetch();
      // approximate token id from latest supply
      setMintedTokenId(newId === 0n ? null : newId);
    }
  }, [confirmed]); // eslint-disable-line react-hooks/exhaustive-deps

  const cleanHandle = useMemo(
    () => handle.trim().replace(/^@/, ""),
    [handle],
  );
  const handleValid = /^[A-Za-z0-9_]{1,15}$/.test(cleanHandle);

  // ── Live PFP preview ───────────────────────────────────────────────
  const [pfpUrl, setPfpUrl] = useState<string | null>(null);
  const [pfpLoading, setPfpLoading] = useState(false);
  const [pfpFallback, setPfpFallback] = useState(false);

  useEffect(() => {
    if (!handleValid) {
      setPfpUrl(null);
      setPfpFallback(false);
      return;
    }
    let cancelled = false;
    setPfpLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await getTwitterPfp({ data: { handle: cleanHandle } });
        if (cancelled) return;
        setPfpUrl(res.imageUrl);
        setPfpFallback(res.fallback);
      } catch {
        if (!cancelled) {
          setPfpUrl(null);
          setPfpFallback(true);
        }
      } finally {
        if (!cancelled) setPfpLoading(false);
      }
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(t);
      setPfpLoading(false);
    };
  }, [cleanHandle, handleValid]);

  const canMint =
    IS_CONTRACT_CONFIGURED &&
    isConnected &&
    !wrongChain &&
    !soldOut &&
    !alreadyMinted &&
    handleValid &&
    !pinning &&
    !writing &&
    !confirming;

  async function handleMint() {
    if (!address) return;
    try {
      setPinning(true);
      const nextId = Number(minted) + 1;
      toast.info("Pinning your Dunce to IPFS…");
      const { tokenURI, imageGatewayUrl } = await pinMintMetadata({
        data: { handle: cleanHandle, nextId, minter: address },
      });
      setMintedImageUrl(imageGatewayUrl);
      setPinning(false);

      toast.info("Confirm the mint in your wallet…");
      await writeContractAsync({
        address: DUNCES_ADDRESS,
        abi: DUNCES_ABI,
        functionName: "mintDunce",
        args: [tokenURI],
        chainId: ritualChain.id,
      });
    } catch (e) {
      setPinning(false);
      const msg = e instanceof Error ? e.message : String(e);
      // Surface contract custom errors in plain language.
      if (msg.includes("AlreadyMinted")) toast.error("Limit 1 mint per wallet.");
      else if (msg.includes("SoldOut")) toast.error("Sold out — all 666 are gone.");
      else if (msg.includes("User rejected")) toast.error("Mint cancelled.");
      else toast.error(msg.slice(0, 160));
    }
  }

  return (
    <Card
      className="w-full max-w-xl border-border/60 backdrop-blur"
      style={{ boxShadow: "var(--shadow-ritual)" }}
    >
      <CardContent className="space-y-6 p-8">
        {/* Supply meter */}
        <div className="space-y-2">
          <div className="flex items-end justify-between font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
            <span>Minted</span>
            <span className="text-foreground">
              {minted.toString()} / {MAX_SUPPLY.toString()}
            </span>
          </div>
          <Progress value={progressPct} className="h-1.5" />
        </div>

        {/* Not-configured warning */}
        {!IS_CONTRACT_CONFIGURED && (
          <div className="rounded-md border border-accent/40 bg-accent/5 p-3 text-xs text-accent">
            Contract address not set. Deploy via{" "}
            <code className="font-mono">npm run deploy</code> in{" "}
            <code className="font-mono">contracts/</code>, then set{" "}
            <code className="font-mono">VITE_DUNCES_ADDRESS</code>.
          </div>
        )}

        {/* Wrong chain */}
        {wrongChain && (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => switchChain({ chainId: ritualChain.id })}
          >
            Switch to Ritual Chain
          </Button>
        )}

        {/* Handle input + mint */}
        {!confirmed && (
          <>
            <div className="space-y-2">
              <label className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                Your Twitter handle
              </label>
              <div className="relative">
                <Twitter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  placeholder="crankywakker"
                  className="pl-9"
                  maxLength={16}
                  disabled={!isConnected || pinning || writing || confirming}
                />
              </div>
              {handle && !handleValid && (
                <p className="text-xs text-destructive">
                  Letters, numbers, underscores. Max 15.
                </p>
              )}
            </div>

            <Button
              size="lg"
              className="w-full text-base font-semibold"
              style={{ background: "var(--gradient-ritual)", color: "var(--ritual-obsidian)" }}
              disabled={!canMint}
              onClick={handleMint}
            >
              {!isConnected
                ? "Connect wallet to mint"
                : soldOut
                  ? "Sold out"
                  : alreadyMinted
                    ? "You've already minted"
                    : pinning
                      ? "Pinning to IPFS…"
                      : writing
                        ? "Confirm in wallet…"
                        : confirming
                          ? "Sealing on-chain…"
                          : "Mint your Dunce — Free"}
            </Button>
          </>
        )}

        {/* Post-mint */}
        {confirmed && (
          <PostMint
            txHash={txHash!}
            handle={cleanHandle}
            tokenId={mintedTokenId ?? minted}
            imageUrl={mintedImageUrl}
          />
        )}
      </CardContent>
    </Card>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function PostMint({
  txHash,
  handle,
  tokenId,
  imageUrl,
}: {
  txHash: `0x${string}`;
  handle: string;
  tokenId: bigint;
  imageUrl: string | null;
}) {
  const explorerUrl = `${ritualChain.blockExplorers.default.url}/tx/${txHash}`;
  const shareText = `I just minted Dunce #${tokenId} of 666 on @ritualfoundation — designed by @crankywakker. Mint yours free:`;
  const shareUrl = typeof window !== "undefined" ? window.location.origin : "";
  const xIntent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`;

  async function download() {
    if (!imageUrl) return;
    try {
      const res = await fetch(imageUrl);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `dunce-${handle}-${tokenId}.jpg`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      toast.error("Couldn't download — image still propagating on IPFS.");
    }
  }

  return (
    <div className="space-y-5 text-center">
      {imageUrl && (
        <img
          src={imageUrl}
          alt={`Dunce #${tokenId}`}
          className="mx-auto h-40 w-40 rounded-full border-2"
          style={{ borderColor: "var(--ritual-gold)" }}
        />
      )}
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-accent">
          Dunce #{tokenId.toString()} sealed
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Welcome to the order, @{handle}.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={download} disabled={!imageUrl}>
          <Download className="mr-2 h-4 w-4" /> Download
        </Button>
        <Button
          asChild
          style={{ background: "var(--gradient-ritual)", color: "var(--ritual-obsidian)" }}
        >
          <a href={xIntent} target="_blank" rel="noreferrer">
            <Twitter className="mr-2 h-4 w-4" /> Share on X
          </a>
        </Button>
      </div>
      <a
        href={explorerUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        View transaction <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}
