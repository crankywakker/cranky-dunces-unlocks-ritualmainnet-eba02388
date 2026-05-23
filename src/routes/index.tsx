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
import {
  pinMintMetadata,
  buildFallbackTokenURI,
  compressImageFile,
} from "@/lib/pin-metadata";
import { useOwnedDunce } from "@/lib/use-owned-dunce";
import { buildShareCard } from "@/lib/build-share-card";
import { Download, ExternalLink, ImageUp, Twitter, Wallet } from "lucide-react";
import dunceLogo from "@/assets/dunce-logo.jpg";

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
        <img
          src={dunceLogo}
          alt="Great Dunces of Ritual"
          className="h-8 w-8 rounded-md object-cover"
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

  // Fetch the user's existing Dunce (if any) so we can show their card on return visits.
  const owned = useOwnedDunce(address, alreadyMinted && !!address);

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

  // ── Uploaded PFP ───────────────────────────────────────────────────
  // We read the file IMMEDIATELY on selection (inside the user-gesture chain)
  // because mobile browsers (iOS Safari, Android Chrome) often revoke access
  // to the underlying file pointer by the time the user clicks "Mint",
  // producing a NotReadableError. Storing the decoded data URL up front
  // means the mint flow no longer touches the original File handle.
  const [pfpFile, setPfpFile] = useState<{
    name: string;
    type: "image/jpeg" | "image/png";
    size: number;
  } | null>(null);
  const [pfpDataUrl, setPfpDataUrl] = useState<string | null>(null);
  const [pfpPreview, setPfpPreview] = useState<string | null>(null);
  const [pfpError, setPfpError] = useState<string | null>(null);

  useEffect(() => {
    setPfpPreview(pfpDataUrl);
  }, [pfpDataUrl]);

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    setPfpError(null);
    const file = e.target.files?.[0];
    if (!file) {
      setPfpFile(null);
      setPfpDataUrl(null);
      return;
    }
    if (!["image/jpeg", "image/png"].includes(file.type)) {
      setPfpError("Only JPEG or PNG images are allowed.");
      setPfpFile(null);
      setPfpDataUrl(null);
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setPfpError("Image must be 5MB or smaller.");
      setPfpFile(null);
      setPfpDataUrl(null);
      return;
    }

    // Read the bytes NOW, while we're still inside the user gesture.
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        setPfpError("Could not read this image. Please try another file.");
        setPfpFile(null);
        setPfpDataUrl(null);
        return;
      }
      setPfpDataUrl(result);
      setPfpFile({
        name: file.name,
        type: file.type as "image/jpeg" | "image/png",
        size: file.size,
      });
    };
    reader.onerror = () => {
      setPfpError(
        "Could not read this image. On mobile, try re-selecting it from your photo library.",
      );
      setPfpFile(null);
      setPfpDataUrl(null);
    };
    reader.readAsDataURL(file);
  }

  function dataUrlToBase64(dataUrl: string): string {
    const idx = dataUrl.indexOf(",");
    return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
  }

  const canMint =
    IS_CONTRACT_CONFIGURED &&
    isConnected &&
    !wrongChain &&
    !soldOut &&
    !alreadyMinted &&
    handleValid &&
    !!pfpFile &&
    !pinning &&
    !writing &&
    !confirming;

  async function handleMint() {
    if (!address || !pfpFile || !pfpDataUrl) return;
    try {
      setPinning(true);
      const nextId = Number(minted) + 1;
      const imageBase64 = dataUrlToBase64(pfpDataUrl);

      let tokenURI: string;
      let imageForCard: string | null = null;
      try {
        toast.info("Pinning your Dunce to IPFS…");
        const pinned = await pinMintMetadata({
          data: {
            handle: cleanHandle,
            nextId,
            minter: address,
            imageBase64,
            imageMime: pfpFile.type as "image/jpeg" | "image/png",
          },
        });
        tokenURI = pinned.tokenURI;
        imageForCard = pinned.imageGatewayUrl;
      } catch (pinErr) {
        // Server pin route unavailable (e.g. 404 on platforms without the API
        // function, network failure, Pinata outage). Fall back to a tiny
        // on-chain-safe data: URI so the mint never gets blocked.
        console.warn("Pin route failed, using fallback tokenURI:", pinErr);
        toast.warning("Metadata service unavailable — minting with lightweight fallback.");
        const fb = buildFallbackTokenURI({ handle: cleanHandle, nextId });
        tokenURI = fb.tokenURI;
        imageForCard = fb.imageDataUri;
      }

      setMintedImageUrl(imageForCard);
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

        {/* Handle input + mint — only when this wallet has NOT yet minted */}
        {!confirmed && !alreadyMinted && (
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

            {/* PFP upload */}
            <div className="space-y-2">
              <label className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                Your Dunce PFP (JPEG or PNG, max 5MB)
              </label>
              <label
                className={`flex cursor-pointer items-center gap-4 rounded-md border border-dashed border-border/60 bg-muted/30 p-3 transition-colors hover:bg-muted/50 ${
                  !isConnected || pinning || writing || confirming
                    ? "pointer-events-none opacity-50"
                    : ""
                }`}
              >
                <div className="relative h-14 w-14 shrink-0">
                  {pfpPreview ? (
                    <img
                      src={pfpPreview}
                      alt="PFP preview"
                      className="h-14 w-14 rounded-full border-2 object-cover"
                      style={{ borderColor: "var(--ritual-gold)" }}
                    />
                  ) : (
                    <div className="flex h-14 w-14 items-center justify-center rounded-full border border-border/60 bg-muted">
                      <ImageUp className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-sm text-foreground">
                    {pfpFile ? pfpFile.name : "Choose an image…"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {pfpFile
                      ? "This is the image that will be sealed on-chain."
                      : "Click to upload from your device."}
                  </p>
                </div>
                <input
                  type="file"
                  accept="image/jpeg,image/png"
                  className="hidden"
                  onChange={onPickFile}
                  disabled={!isConnected || pinning || writing || confirming}
                />
              </label>
              {pfpError && (
                <p className="text-xs text-destructive">{pfpError}</p>
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

        {/* Post-mint card — fresh mint */}
        {confirmed && (
          <PostMint
            txHash={txHash!}
            handle={cleanHandle}
            tokenId={mintedTokenId ?? minted}
            localPfpUrl={pfpPreview}
            imageUrl={mintedImageUrl}
          />
        )}

        {/* Persistent "Your Dunce" view — wallet already owns one */}
        {!confirmed && alreadyMinted && (
          <>
            {owned.loading && !owned.data && (
              <p className="text-center text-sm text-muted-foreground">
                Loading your Dunce…
              </p>
            )}
            {owned.error && (
              <p className="text-center text-sm text-destructive">
                {owned.error}
              </p>
            )}
            {owned.data && (
              <PostMint
                txHash={owned.data.txHash ?? undefined}
                handle={owned.data.handle}
                tokenId={owned.data.tokenId}
                localPfpUrl={null}
                imageUrl={owned.data.imageUrl}
                heading="Your Dunce NFT"
              />
            )}
          </>
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
  localPfpUrl,
  imageUrl,
  heading,
}: {
  txHash?: `0x${string}`;
  handle: string;
  tokenId: bigint;
  localPfpUrl: string | null;
  imageUrl: string | null;
  heading?: string;
}) {
  const explorerUrl = txHash
    ? `${ritualChain.blockExplorers.default.url}/tx/${txHash}`
    : null;
  const shareUrl = "https://cranky-dunces-unlocks-ritualmainnet.lovable.app/";
  const shareText = `I just minted Dunce #${tokenId} of 666 on @ritualnet designed by @jumplifey9. Mint yours for free: ${shareUrl}`;
  const xIntent = `https://x.com/intent/tweet?text=${encodeURIComponent(shareText)}`;

  const [cardUrl, setCardUrl] = useState<string | null>(null);
  const [cardBlob, setCardBlob] = useState<Blob | null>(null);
  const [building, setBuilding] = useState(true);

  useEffect(() => {
    let revoke: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        setBuilding(true);
        const pfpSrc = localPfpUrl ?? imageUrl;
        if (!pfpSrc) return;
        const blob = await buildShareCard({
          pfpUrl: pfpSrc,
          dunceNumber: tokenId,
          handle,
        });
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        revoke = url;
        setCardBlob(blob);
        setCardUrl(url);
      } catch (e) {
        console.error(e);
        toast.error("Couldn't render share card.");
      } finally {
        if (!cancelled) setBuilding(false);
      }
    })();
    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [localPfpUrl, imageUrl, tokenId, handle]);

  function download() {
    if (!cardBlob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(cardBlob);
    a.download = `dunce-${handle}-${String(tokenId)}.png`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function shareOnX() {
    window.open(xIntent, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="space-y-5 text-center">
      <div className="overflow-hidden rounded-lg border border-border/60 aspect-[16/9] bg-muted">
        {cardUrl ? (
          <img
            src={cardUrl}
            alt={`Dunce #${tokenId} share card`}
            className="block h-full w-full object-contain"
          />
        ) : (
          <div className="flex aspect-[16/9] items-center justify-center bg-muted text-xs text-muted-foreground">
            {building ? "Rendering your card…" : "Card unavailable"}
          </div>
        )}
      </div>
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-accent">
          {heading ?? `Dunce #${tokenId.toString()} sealed`}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Welcome to the order, @{handle}.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={download} disabled={!cardBlob}>
          <Download className="mr-2 h-4 w-4" /> Download card
        </Button>
        <Button
          onClick={shareOnX}
          style={{ background: "var(--gradient-ritual)", color: "var(--ritual-obsidian)" }}
        >
          <Twitter className="mr-2 h-4 w-4" /> Share on X
        </Button>
      </div>
      {explorerUrl && (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          View transaction <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}
