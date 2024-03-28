import Web3 from "web3";
import {
  getParamsForSendMultiSigFunction,
  sendMultiSigTransactionToAuthoriseFailSafeOrchestrator as sendMultiSigTransaction,
  getNextSequenceId,
} from "../Step-2-Setting-up-Compensation-For-Gas/helper.js";
import FailSafeRecoveryVaultABI from "./FailSafeRecoveryVaultABI.json" assert { type: "json" }; // Trimmed ABI of FailSafeRecoveryVaultABI contract ABI
import { logMessage, LOG_LEVELS } from "../common/helper.js";

export function getWeb3Object(chainId) {
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

export async function getSignature(message, chainId, privateKey) {
  const web3 = getWeb3Object(chainId);
  const signedMessage = web3.eth.accounts.sign(message, privateKey);
  return signedMessage.signature;
}

async function getWrappedWithdrawTransactionDataField(
  chainId,
  wrappedWithdrawFunctionParams,
  failSafeRecoveryVault
) {
  try {
    const web3 = await getWeb3Object(chainId);

    const failSafeRecoveryVaultContract = new web3.eth.Contract(
      FailSafeRecoveryVaultABI,
      failSafeRecoveryVault
    );

    const wrappedWithdrawTransactionDataField =
      await failSafeRecoveryVaultContract.methods
        .wrappedWithdraw(
          wrappedWithdrawFunctionParams["tokenContract"],
          wrappedWithdrawFunctionParams["amount"],
          wrappedWithdrawFunctionParams["expiryBlockNum"],
          wrappedWithdrawFunctionParams["withdrawCounter"],
          wrappedWithdrawFunctionParams["fleetKeySignature"],
          wrappedWithdrawFunctionParams["fleetKeyProof"]
        )
        .encodeABI();

    logMessage(
      LOG_LEVELS.DEBUG,
      "Wrapped withdraw transaction data field: " +
        JSON.stringify(wrappedWithdrawTransactionDataField, null, 2)
    );

    return wrappedWithdrawTransactionDataField;
  } catch (error) {
    console.error(error);
    return null;
  }
}

export async function sendMultiSigTransactionToWithdrawERC20Asset(
  bitgoMultiSigContractAddress,
  bitgoUserWalletAddress,
  bitgoUserWalletPrv,
  bitgoBackupWalletPrv,
  chainId,
  failsafeRecoveryVaultAddress,
  wrappedWithdrawFunctionParameters
) {
  const expiryTime = new Date().getTime() + 3600000; // This expiry time is verified by BitGo's Multi-signature smart contract
  const sequenceId = await getNextSequenceId(
    chainId,
    bitgoMultiSigContractAddress
  );

  const wrappedWithdrawFunctionParametersABIEncoded =
    await getWrappedWithdrawTransactionDataField(
      chainId,
      wrappedWithdrawFunctionParameters,
      failsafeRecoveryVaultAddress
    );

  const sendMultiSigFunctionParams = await getParamsForSendMultiSigFunction(
    failsafeRecoveryVaultAddress,
    wrappedWithdrawFunctionParametersABIEncoded,
    bitgoBackupWalletPrv,
    chainId,
    expiryTime,
    sequenceId
  );

  return await sendMultiSigTransaction(
    bitgoMultiSigContractAddress,
    bitgoUserWalletAddress,
    bitgoUserWalletPrv,
    chainId,
    sendMultiSigFunctionParams
  );
}
