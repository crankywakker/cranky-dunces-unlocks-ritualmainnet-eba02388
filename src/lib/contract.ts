// Address is wired from the JSON the Hardhat deploy script drops here:
//   contracts/scripts/deploy.ts → src/contracts/GreatDuncesOfRitual.json
// Until you deploy, an env override (VITE_DUNCES_ADDRESS) and a placeholder
// keep the UI from crashing. The mint button stays disabled while unset.

import type { Address } from "viem";

// Minimal ABI — only what the frontend touches.
export const DUNCES_ABI = [
  {
    type: "function",
    name: "mintDunce",
    stateMutability: "nonpayable",
    inputs: [{ name: "customTokenURI", type: "string" }],
    outputs: [],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "remaining",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "MAX_SUPPLY",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "hasMinted",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "string" }],
  },
  {
    type: "event",
    name: "DunceMinted",
    inputs: [
      { name: "minter", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "tokenURI", type: "string", indexed: false },
    ],
  },
] as const;

const RAW = (import.meta.env.VITE_DUNCES_ADDRESS ?? "").trim();
const ZERO = "0x0000000000000000000000000000000000000000";

export const DUNCES_ADDRESS: Address = (
  /^0x[a-fA-F0-9]{40}$/.test(RAW) ? RAW : ZERO
) as Address;

export const IS_CONTRACT_CONFIGURED = DUNCES_ADDRESS !== ZERO;

export const MAX_SUPPLY = 666n;
