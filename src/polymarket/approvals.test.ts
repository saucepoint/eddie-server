import { describe, expect, test } from "bun:test";
import { decodeFunctionData, maxUint256, type Hex } from "viem";
import { createApprovalTransactions } from "./approvals";
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

describe("approval transaction builder", () => {
  test("creates the full Polymarket approval batch", () => {
    const transactions = createApprovalTransactions();

    expect(transactions).toHaveLength(7);

    for (const [index, transaction] of transactions.entries()) {
      expect(transaction.value).toBe("0");

      if (index < ERC20_APPROVAL_SPENDERS.length) {
        const decoded = decodeFunctionData({
          abi: erc20Abi,
          data: transaction.data as Hex,
        });

        expect(transaction.to).toBe(POLYMARKET_CONTRACTS.usdc);
        expect(decoded.functionName).toBe("approve");
        expect(decoded.args).toEqual([
          ERC20_APPROVAL_SPENDERS[index],
          maxUint256,
        ]);
        continue;
      }

      const decoded = decodeFunctionData({
        abi: erc1155Abi,
        data: transaction.data as Hex,
      });
      const spender = ERC1155_APPROVAL_SPENDERS[index - ERC20_APPROVAL_SPENDERS.length];

      expect(transaction.to).toBe(POLYMARKET_CONTRACTS.ctf);
      expect(decoded.functionName).toBe("setApprovalForAll");
      expect(decoded.args).toEqual([spender, true]);
    }
  });
});
