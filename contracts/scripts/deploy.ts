import { ethers, network, run } from "hardhat";

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
  console.log(`✓ Deployed to: ${addr}`);
  console.log(`  Explorer:    https://explorer.ritualfoundation.org/address/${addr}`);

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
