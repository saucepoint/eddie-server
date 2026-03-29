import { encodeFunctionData, maxUint256 } from "viem";
import type { Transaction } from "@polymarket/builder-relayer-client";
import {
  ERC20_APPROVAL_SPENDERS,
  ERC1155_APPROVAL_SPENDERS,
  POLYMARKET_CONTRACTS,
} from "./constants";

const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const erc1155Abi = [
  {
    type: "function",
    name: "setApprovalForAll",
    stateMutability: "nonpayable",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
] as const;

export const createApprovalTransactions = (): Transaction[] => [
  ...ERC20_APPROVAL_SPENDERS.map(
    spender =>
      ({
        to: POLYMARKET_CONTRACTS.usdc,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [spender, maxUint256],
        }),
        value: "0",
      }) satisfies Transaction,
  ),
  ...ERC1155_APPROVAL_SPENDERS.map(
    spender =>
      ({
        to: POLYMARKET_CONTRACTS.ctf,
        data: encodeFunctionData({
          abi: erc1155Abi,
          functionName: "setApprovalForAll",
          args: [spender, true],
        }),
        value: "0",
      }) satisfies Transaction,
  ),
];
