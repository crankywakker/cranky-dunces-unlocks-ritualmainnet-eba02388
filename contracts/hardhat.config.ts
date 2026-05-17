import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY ?? "";
const RITUAL_RPC  = process.env.RITUAL_RPC_URL ?? "https://rpc.ritualfoundation.org";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
    },
  },
  networks: {
    ritual: {
      url: RITUAL_RPC,
      chainId: 1979,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },
  etherscan: {
    // Ritual block explorer (Blockscout-style verification).
    apiKey: { ritual: "empty" },
    customChains: [
      {
        network: "ritual",
        chainId: 1979,
        urls: {
          apiURL:     "https://explorer.ritualfoundation.org/api",
          browserURL: "https://explorer.ritualfoundation.org",
        },
      },
    ],
  },
};

export default config;
