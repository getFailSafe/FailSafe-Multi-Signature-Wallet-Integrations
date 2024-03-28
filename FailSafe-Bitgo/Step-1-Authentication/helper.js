import Web3 from "web3";

export async function getWeb3Object(chainId) {
  let providerUrl = "";
  // Set the provider URL based on the chain ID
  switch (chainId) {
    case 1: // Ethereum Mainnet
      providerUrl = `https://mainnet.infura.io/v3/80ad14d1287a4669a0889f5d735391a7`;
      break;
    case 137: // Polygon Mainnet
      providerUrl = `https://polygon-mainnet.infura.io/v3/80ad14d1287a4669a0889f5d735391a7`;
      break;
    case 56: // Binance Smart Chain
      providerUrl = "https://bsc-dataseed.binance.org/";
      break;
    case 43114: // Avalanche C CHain
      providerUrl = "https://api.avax.network/ext/bc/C/rpc";
      break;
    default:
      throw new Error("Unsupported network");
  }

  // Re-initialize the web3 instance with the new providerUrl
  const web3 = new Web3(providerUrl);
  return web3;
}
