import type { Chain } from "viem";
import { polygon, polygonAmoy } from "viem/chains";
import { resolveEncryptionKey } from "../crypto/encryption";
import { ConfigError } from "../errors";

type EnvSource = Record<string, string | undefined>;

export type RuntimeConfig = {
  relayerUrl: string;
  rpcUrl: string;
  chainId: number;
  chain: Chain;
  builderApiKey: string;
  builderSecret: string;
  builderPassphrase: string;
  encryptionKey: Buffer;
};

const getRequiredEnv = (env: EnvSource, name: string) => {
  const value = env[name]?.trim();

  if (!value) {
    throw new ConfigError(`${name} is required.`);
  }

  return value;
};

const resolveChain = (chainId: number) => {
  switch (chainId) {
    case polygon.id:
      return polygon;
    case polygonAmoy.id:
      return polygonAmoy;
    default:
      throw new ConfigError(
        `POLYMARKET_CHAIN_ID ${chainId} is unsupported. Use 137 or 80002.`,
      );
  }
};

export const loadRuntimeConfig = (env: EnvSource = Bun.env) => {
  const chainId = Number(env.POLYMARKET_CHAIN_ID ?? "137");

  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new ConfigError("POLYMARKET_CHAIN_ID must be a positive integer.");
  }

  return {
    relayerUrl: "https://relayer-v2.polymarket.com/",
    rpcUrl: getRequiredEnv(env, "POLYMARKET_RPC_URL"),
    chainId,
    chain: resolveChain(chainId),
    builderApiKey: getRequiredEnv(env, "POLYMARKET_BUILDER_API_KEY"),
    builderSecret: getRequiredEnv(env, "POLYMARKET_BUILDER_SECRET"),
    builderPassphrase: getRequiredEnv(env, "POLYMARKET_BUILDER_PASSPHRASE"),
    encryptionKey: resolveEncryptionKey(
      getRequiredEnv(env, "USER_WALLET_ENCRYPTION_KEY"),
    ),
  } satisfies RuntimeConfig;
};
