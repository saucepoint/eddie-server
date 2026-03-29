import { BuilderConfig } from "@polymarket/builder-signing-sdk";
import { RelayClient } from "@polymarket/builder-relayer-client";
import { deriveSafe } from "@polymarket/builder-relayer-client/dist/builder/derive";
import { getContractConfig } from "@polymarket/builder-relayer-client/dist/config";
import { createWalletClient, http, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { RelayerError } from "../errors";
import { createApprovalTransactions } from "./approvals";
import type { RuntimeConfig } from "./config";

export type WalletBootstrapResult = {
  privateKey: Hex;
  walletAddress: Hex;
  safeAddress: string;
  safeDeploymentTransactionId: string;
  safeDeploymentTransactionHash: string;
  approvalTransactionId: string;
  approvalTransactionHash: string;
};

export const bootstrapPolymarketWallet = async (
  config: RuntimeConfig,
): Promise<WalletBootstrapResult> => {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({
    account,
    chain: config.chain,
    transport: http(config.rpcUrl),
  });

  const builderConfig = new BuilderConfig({
    localBuilderCreds: {
      key: config.builderApiKey,
      secret: config.builderSecret,
      passphrase: config.builderPassphrase,
    },
  });

  const relayClient = new RelayClient(
    config.relayerUrl,
    config.chainId,
    walletClient,
    builderConfig as never,
  );

  const contractConfig = getContractConfig(config.chainId);
  const safeAddress = deriveSafe(
    account.address,
    contractConfig.SafeContracts.SafeFactory,
  );

  let safeDeploymentTransactionId = "already_deployed";
  let safeDeploymentTransactionHash = "already_deployed";

  try {
    const deployed = await relayClient.getDeployed(safeAddress);

    if (!deployed) {
      const deploymentResponse = await relayClient.deploy();
      const deploymentResult = await deploymentResponse.wait();

      if (!deploymentResult?.transactionHash) {
        throw new RelayerError("Safe deployment did not complete successfully.");
      }

      safeDeploymentTransactionId = deploymentResult.transactionID;
      safeDeploymentTransactionHash = deploymentResult.transactionHash;
    }

    const approvalResponse = await relayClient.execute(
      createApprovalTransactions(),
      "Set token approvals",
    );
    const approvalResult = await approvalResponse.wait();

    if (!approvalResult?.transactionHash) {
      throw new RelayerError("Token approvals did not complete successfully.");
    }

    return {
      privateKey,
      walletAddress: account.address,
      safeAddress,
      safeDeploymentTransactionId,
      safeDeploymentTransactionHash,
      approvalTransactionId: approvalResult.transactionID,
      approvalTransactionHash: approvalResult.transactionHash,
    };
  } catch (error) {
    if (error instanceof RelayerError) {
      throw error;
    }

    throw new RelayerError(
      "Polymarket wallet bootstrap failed during Safe deployment or approvals.",
      error,
    );
  }
};
