import dotenv from "dotenv"; // Load environment variables from .env file
dotenv.config({ path: "../.env" });

import { default as axios } from "axios";
import { Eth } from "@bitgo/account-lib";
import { BitGoAPI } from "@bitgo/sdk-api";
import {
  getApproveFailSafeOrchestratorTransactionDataField,
  getParamsForSendMultiSigFunction,
  sendMultiSigTransactionToAuthoriseFailSafeOrchestrator,
  getNextSequenceId,
} from "./helper.js";
import { logMessage, LOG_LEVELS } from "../common/helper.js";
import { Polygon } from "@bitgo/sdk-coin-polygon";
import { performFailSafeLoginSequence } from "../Step-1-Authentication/index.js";

// API access token is required to access BitGo Apis. Create an access token by following the BitGo developer guide here: https://developers.bitgo.com/guides/get-started/access-tokens
const bitgo = new BitGoAPI({
  accessToken: process.env.BITGO_ACCESS_TOKEN,
  env: "prod",
});

const failSafeAPIBaseURL = process.env.FAILSAFE_API_BASEURL;
// Your FailSafe API key (make sure to replace it with your actual API key)
const failSafeAPIKey = process.env.FAILSAFE_API_KEY;

async function main() {
  bitgo.register("polygon", Polygon.createInstance);

  // Create a new multi-signature hot wallet.
  // We are creating a new multi-signature hot wallet to get access to the un-encrypted private key of the `Backup` wallet address and the un-encrypted private key of the `user wallet address`
  // For an existing multi-signature hot wallet address, we can only obtain the unencrypted private key of the `user` wallet address
  // In this guide, we will fulfill 2 out of 3 condition enforced by BitGo's `WalletSimple.sol` smart contract (https://github.com/BitGo/eth-multisig-v4/blob/master/contracts/WalletSimple.sol) using the `backup` and `user` wallets private keys.
  // We will bypass the `bitgo` wallet's private key which BitGo never exposes to the developers or anyone

  // Uncomment below code block if you want to create a new BitGo multi-signature hot wallet using BitGo SDK

  // Enter the enterprise id. The enterprise id can be obtained from the URL after logging into BitGo wallet.
  /* 

  const enterpriseId = process.env.BITGO_ENTERPRISE_ID;
  const newWallet = await bitgo.coin("polygon").wallets().generateWallet({
    label: "SDK Wallet Test",
    passphrase: process.env.BITGO_ACCOUNT_PASSWORD,
    enterprise: enterpriseId,
  });

  console.log(JSON.stringify(newWallet, undefined, 2)); */

  // Note down the userKeychain.prv and backupKeychain.prv from the output. The private keys returned in this step are base58 encoded
  // Pause execution of this program at this point. Ensure that the `wallet.userKeychain.ethAddress` is funded with MATIC tokens to cover for the gas cost for the steps mentioned in the SECTION - AUTHORISE FAILSAFE ORCHESTRATOR CONTRACT TO SPEND WMATIC TOKEN.

  /* const userKeyPrivateKeyBase58Encoded = wallet.userKeychain.prv;
  const backupKeyPrivateKeyBase58Encoded = wallet.backupKeychain.prv;

  const userKeyEthAddress = wallet.userKeychain.ethAddress; */

  const userKeyPrivateKeyBase58Encoded =
    process.env.USER_KEY_PRIVATE_KEY_BASE58_ENCODED;
  const backupKeyPrivateKeyBase58Encoded =
    process.env.BACKUP_KEY_PRIVATE_KEY_BASE58_ENCODED;

  const userKeyEthAddress = process.env.USER_KEY_WALLET_ADDRESS;

  // Use BitGo account library to get the ethereum wallet address and private key in plain text
  const userKeys = new Eth.KeyPair({
    prv: userKeyPrivateKeyBase58Encoded,
  }).getKeys();

  logMessage(
    LOG_LEVELS.DEBUG,
    "User keys: " + JSON.stringify(userKeys, null, 2)
  );

  const backupKeys = new Eth.KeyPair({
    prv: backupKeyPrivateKeyBase58Encoded,
  }).getKeys();

  logMessage(
    LOG_LEVELS.DEBUG,
    "Backup keys: " + JSON.stringify(backupKeys, null, 2)
  );

  // Perform sequence of steps to authorise FailSafe Orchestrator to spend Wrapped Matic Token from BitGo multi-signature wallet

  // Params required for next three steps
  const chainId = parseInt(process.env.CHAIN_ID);
  const wMATICContractAddress = "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270";
  const bitgoMultiSigContractAddress =
    process.env.BITGO_MULTISIG_CONTRACT_ADDRESS; // Replace with the WalletSimple.sol contract address deployed by your BitGo Multi-Signature Hot Wallet
  const expiryTime = new Date().getTime() + 3600000; // This expiry time is verified by BitGo's Multi-signature smart contract
  const sequenceId = await getNextSequenceId(
    chainId,
    bitgoMultiSigContractAddress
  );
  // Execute Step-1-Authentication and replace authorizationToken below with your own authorization token
  const authorizationToken = await performFailSafeLoginSequence();

  // SECTION - AUTHORISE FAILSAFE ORCHESTRATOR CONTRACT TO SPEND WMATIC TOKEN

  // Step 1 is to retrieve FailSafe Orchestrator contract for the given chain id
  const config = {
    headers: {
      "x-api-key": failSafeAPIKey,
      Authorization: `Bearer ${authorizationToken}`,
    },
  };

  const endpoint1 = `${failSafeAPIBaseURL}failsafe/app-configuration?chain_id=${chainId}&name=FailsafeOrchestrator`;
  const response1 = await axios.get(endpoint1, config);
  const failsafeOrchestratorAddress = response1.data.value;
  logMessage(
    LOG_LEVELS.DEBUG,
    "Failsafe Orchestrator Address: " + failsafeOrchestratorAddress
  );

  // Step 2 - Obtain data field of Wrapped Matic Token contract's approve method
  const approveDataField =
    await getApproveFailSafeOrchestratorTransactionDataField(
      chainId,
      failsafeOrchestratorAddress,
      wMATICContractAddress
    );

  // Step 3 - Obtain data field of Wrapped Matic Token contract's approve method
  const paramsForSendMultiSigFunction = await getParamsForSendMultiSigFunction(
    wMATICContractAddress,
    approveDataField,
    backupKeys.prv,
    chainId,
    expiryTime,
    sequenceId
  );

  logMessage(
    LOG_LEVELS.DEBUG,
    "Params for multi-sig: " + JSON.stringify(paramsForSendMultiSigFunction)
  );

  // Step 4 - Send transaction to WalletSimple.sol's sendMultiSig function
  const sendMultiSigTransactionResponse =
    await sendMultiSigTransactionToAuthoriseFailSafeOrchestrator(
      bitgoMultiSigContractAddress,
      userKeyEthAddress,
      userKeys.prv,
      chainId,
      paramsForSendMultiSigFunction
    );
  logMessage(
    LOG_LEVELS.NECESSARY,
    "sendMultiSig response: " +
      JSON.stringify(sendMultiSigTransactionResponse, null, 2)
  );
}

(async () => {
  await main();
})();
