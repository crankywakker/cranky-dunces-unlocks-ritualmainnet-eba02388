import { ethers, network, run, artifacts } from "hardhat";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`\n→ Deploying GreatDuncesOfRitual to '${network.name}' (chainId ${network.config.chainId})`);
  console.log(`→ Deployer: ${deployer.address}`);
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log(`→ Balance:  ${ethers.formatEther(bal)} RITUAL\n`);

  const Factory = await ethers.getContractFactory("GreatDuncesOfRitual");
  const c = await Factory.deploy(deployer.address);
  await c.waitForDeployment();

  const addr = await c.getAddress();
  const tx   = c.deploymentTransaction();
  console.log(`✓ Deployed to: ${addr}`);
  console.log(`  Explorer:    https://explorer.ritualfoundation.org/address/${addr}`);

  // -------------------------------------------------------------------------
  // Post-deploy: write { address, abi, chainId, ... } for frontend consumption
  // -------------------------------------------------------------------------
  const artifact = await artifacts.readArtifact("GreatDuncesOfRitual");
  const chainId  = Number(network.config.chainId ?? (await ethers.provider.getNetwork()).chainId);

  const deployment = {
    name:            "GreatDuncesOfRitual",
    address:         addr,
    chainId,
    network:         network.name,
    deployer:        deployer.address,
    deploymentTx:    tx?.hash ?? null,
    blockNumber:     tx?.blockNumber ?? null,
    explorer:        `https://explorer.ritualfoundation.org/address/${addr}`,
    deployedAt:      new Date().toISOString(),
    abi:             artifact.abi,
    bytecodeHash:    ethers.keccak256(artifact.bytecode),
  };

  // 1) Per-network snapshot (kept in git, one file per deploy target)
  const perNetworkPath = join(__dirname, "..", "deployments", `${network.name}.json`);
  mkdirSync(dirname(perNetworkPath), { recursive: true });
  writeFileSync(perNetworkPath, JSON.stringify(deployment, null, 2));
  console.log(`✓ Wrote ${perNetworkPath}`);

  // 2) Frontend-ready copy: drop into src/contracts/ so the React app can
  //    `import deployment from "@/contracts/GreatDuncesOfRitual.json"`.
  const frontendPath = join(__dirname, "..", "..", "src", "contracts", "GreatDuncesOfRitual.json");
  try {
    mkdirSync(dirname(frontendPath), { recursive: true });
    writeFileSync(frontendPath, JSON.stringify(deployment, null, 2));
    console.log(`✓ Wrote ${frontendPath}`);
  } catch (e: any) {
    console.warn(`! Skipped frontend copy (${e?.message ?? e})`);
  }

  if (network.name === "ritual") {
    console.log("\n→ Waiting 30s before verification…");
    await new Promise((r) => setTimeout(r, 30_000));
    try {
      await run("verify:verify", { address: addr, constructorArguments: [deployer.address] });
      console.log("✓ Verified on Ritual Explorer");
    } catch (e: any) {
      console.warn("! Verification failed (run `npx hardhat verify` manually):", e?.message ?? e);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
