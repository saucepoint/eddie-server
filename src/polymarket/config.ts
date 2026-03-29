import type { Chain } from "viem";
import { polygon, polygonAmoy } from "viem/chains";
import { resolveEncryptionKey } from "../crypto/encryption";
import { ConfigError } from "../errors";

type EnvSource = Record<string, string | undefined>;

type SharedPolymarketConfig = {
  chainId: number;
  chain: Chain;
  gammaHost: string;
  clobHost: string;
};

export type RuntimeConfig = SharedPolymarketConfig & {
  relayerUrl: string;
  rpcUrl: string;
  builderApiKey: string;
  builderSecret: string;
  builderPassphrase: string;
  encryptionKey: Buffer;
};

export type MarketRuntimeConfig = SharedPolymarketConfig & {
  testEndpointSecret: string;
};

export type TradeRuntimeConfig = SharedPolymarketConfig & {
  rpcUrl: string;
  builderApiKey: string;
  builderSecret: string;
  builderPassphrase: string;
  encryptionKey: Buffer;
  testEndpointSecret: string;
  liveTradingEnabled: boolean;
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

const resolveSharedConfig = (env: EnvSource) => {
  const chainId = Number(env.POLYMARKET_CHAIN_ID ?? "137");

  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new ConfigError("POLYMARKET_CHAIN_ID must be a positive integer.");
  }

  return {
    chainId,
    chain: resolveChain(chainId),
    gammaHost: (env.POLYMARKET_GAMMA_HOST ?? "https://gamma-api.polymarket.com").trim(),
    clobHost: (env.POLYMARKET_CLOB_HOST ?? "https://clob.polymarket.com").trim(),
  } satisfies SharedPolymarketConfig;
};

export const loadRuntimeConfig = (env: EnvSource = Bun.env) => {
  const sharedConfig = resolveSharedConfig(env);

  return {
    ...sharedConfig,
    relayerUrl: "https://relayer-v2.polymarket.com/",
    rpcUrl: getRequiredEnv(env, "POLYMARKET_RPC_URL"),
    builderApiKey: getRequiredEnv(env, "POLYMARKET_BUILDER_API_KEY"),
    builderSecret: getRequiredEnv(env, "POLYMARKET_BUILDER_SECRET"),
    builderPassphrase: getRequiredEnv(env, "POLYMARKET_BUILDER_PASSPHRASE"),
    encryptionKey: resolveEncryptionKey(
      getRequiredEnv(env, "USER_WALLET_ENCRYPTION_KEY"),
    ),
  } satisfies RuntimeConfig;
};

export const loadMarketRuntimeConfig = (env: EnvSource = Bun.env) => {
  const sharedConfig = resolveSharedConfig(env);

  return {
    ...sharedConfig,
    testEndpointSecret: getRequiredEnv(env, "POLYMARKET_TEST_ENDPOINT_SECRET"),
  } satisfies MarketRuntimeConfig;
};

export const loadTradeRuntimeConfig = (env: EnvSource = Bun.env) => {
  const sharedConfig = resolveSharedConfig(env);

  return {
    ...sharedConfig,
    rpcUrl: getRequiredEnv(env, "POLYMARKET_RPC_URL"),
    builderApiKey: getRequiredEnv(env, "POLYMARKET_BUILDER_API_KEY"),
    builderSecret: getRequiredEnv(env, "POLYMARKET_BUILDER_SECRET"),
    builderPassphrase: getRequiredEnv(env, "POLYMARKET_BUILDER_PASSPHRASE"),
    encryptionKey: resolveEncryptionKey(
      getRequiredEnv(env, "USER_WALLET_ENCRYPTION_KEY"),
    ),
    testEndpointSecret: getRequiredEnv(env, "POLYMARKET_TEST_ENDPOINT_SECRET"),
    liveTradingEnabled: (env.POLYMARKET_ENABLE_TEST_TRADES ?? "").trim().toLowerCase() === "true",
  } satisfies TradeRuntimeConfig;
};
