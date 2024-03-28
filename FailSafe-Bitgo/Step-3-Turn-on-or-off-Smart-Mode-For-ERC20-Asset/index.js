import "dotenv/config.js"; // Load environment variables from .env file
import { default as axios } from "axios";
import { Eth } from "@bitgo/account-lib";
import { getSignature } from "./helper.js";
import {
  getApproveFailSafeRecoveryVaultTransactionDataField,
  getParamsForSendMultiSigFunction,
  sendMultiSigTransactionToAuthoriseFailSafeOrchestrator,
  getNextSequenceId,
} from "./helper.js";
import { performFailSafeLoginSequence } from "../Step-1-Authentication/index.js";
import { logMessage, LOG_LEVELS } from "../common/helper.js";

const failSafeAPIBaseURL = process.env.FAILSAFE_API_BASEURL;
// Your FailSafe API key (make sure to replace it with your actual API key)
const failSafeAPIKey = process.env.FAILSAFE_API_KEY;

let messageTemplate = `FailSafe verification\nOTP: $NONCE\nNever share your OTP with anyone.`;

const ERC20TokenAddress = process.env.ERC20_ASSET_TOKEN_ADDRESS;

// @DEV - To familiarize with the steps required to turn on FailSafe protection, please check this developer guide - https://failsafe.stoplight.io/docs/failsafe-sdk/i2rko8y25ojek-erc-20-tokens-protection

async function main() {
  // Execute Step-1-Authentication and replace authorizationToken below with your own authorization token
  const authorizationToken = await performFailSafeLoginSequence();
  const config = {
    headers: {
      "x-api-key": failSafeAPIKey,
      Authorization: `Bearer ${authorizationToken}`,
    },
  };
  const bitgoMultiSigContractAddress =
    process.env.BITGO_MULTISIG_CONTRACT_ADDRESS; // <Replace this with your BitGo Multi-Signature Hot Wallet Contract address

  const userKeyWalletAddress = process.env.USER_KEY_WALLET_ADDRESS; // We are using the user key wallet address. But backup key wallet address or bitgo wallet address can also be used
  const userKeyPrivateKeyBase58Encoded =
    process.env.USER_KEY_PRIVATE_KEY_BASE58_ENCODED;
  const backupKeyPrivateKeyBase58Encoded =
    process.env.BACKUP_KEY_PRIVATE_KEY_BASE58_ENCODED;

  const chainId = parseInt(process.env.CHAIN_ID);

  // Use BitGo account library to get the ethereum wallet address and private key in plain text
  const userKeys = new Eth.KeyPair({
    prv: userKeyPrivateKeyBase58Encoded,
  }).getKeys();

  const backupKeys = new Eth.KeyPair({
    prv: backupKeyPrivateKeyBase58Encoded,
  }).getKeys();

  // Turning on FailSafe protection for an ERC20 asset is a 5 step process

  // Step 1 is to retrieve balance of ERC20 tokens in the Bitgo multi-signature hot wallet
  const endpoint1 = `${failSafeAPIBaseURL}wallets/balance?chain_id=${chainId}&wallet_address=${bitgoMultiSigContractAddress}`;
  const response1 = await axios.get(endpoint1, config);

  logMessage(
    LOG_LEVELS.NECESSARY,
    "Assets and balances in BitGo multi-signature smart contract: " +
      JSON.stringify(response1.data)
  );

  // Step 2 is to retrieve FailSafe Recovery Vault Smart Contract linked with the Bitgo multi-signature hot wallet
  const endpoint2 = `${failSafeAPIBaseURL}wallets/failsafewallet?wallet_address=${bitgoMultiSigContractAddress}&chain_id=${chainId}`;
  const response2 = await axios.get(endpoint2, config);
  const failsafeRecoveryVault = response2.data.failsafeWallet;
  logMessage(
    LOG_LEVELS.DEBUG,
    "Recovery Vault Contract Address: " + failsafeRecoveryVault
  );

  // Step 3 is to authorise FailSafe Recovery Vault Smart Contract to spend the ERC-20 token
  const expiryTime = new Date().getTime() + 3600000; // This expiry time is verified by BitGo's Multi-signature smart contract
  const sequenceId = await getNextSequenceId(
    chainId,
    bitgoMultiSigContractAddress
  );

  const approveDataField =
    await getApproveFailSafeRecoveryVaultTransactionDataField(
      chainId,
      failsafeRecoveryVault,
      ERC20TokenAddress
    );

  // Step 3a - Obtain data field of Wrapped Matic Token contract's approve method
  const paramsForSendMultiSigFunction = await getParamsForSendMultiSigFunction(
    ERC20TokenAddress,
    approveDataField,
    backupKeys.prv,
    chainId,
    expiryTime,
    sequenceId
  );

  logMessage(
    LOG_LEVELS.DEBUG,
    "Params for multi-sig: " +
      JSON.stringify(paramsForSendMultiSigFunction, null, 2)
  );

  // Step 3b - Send transaction to WalletSimple.sol's sendMultiSig function
  const sendMultiSigTransactionResponse =
    await sendMultiSigTransactionToAuthoriseFailSafeOrchestrator(
      bitgoMultiSigContractAddress,
      userKeyWalletAddress,
      userKeys.prv,
      chainId,
      paramsForSendMultiSigFunction
    );

  logMessage(
    LOG_LEVELS.DEBUG,
    "Send multi sig transaction response: " +
      JSON.stringify(sendMultiSigTransactionResponse, null, 2)
  );

  // Step 4 is to retrieve a nonce from FailSafe API. You will sign this nonce with one of the Bitgo wallets to prove ownership of the Bitgo multi-signature contract
  const endpoint4 = `${failSafeAPIBaseURL}auth/get-nonce?wallet_address=${bitgoMultiSigContractAddress}`;
  let response4 = await axios.get(endpoint4, config);
  let nonce = response4.data.nonce;

  // Step 5 is to send a payload to FailSafe API, to turn on Safe Mode protction for an ERC20 token.
  const endpoint5 = `${failSafeAPIBaseURL}wallets/protected`;

  const XENCryptoTokenState = response1.data.filter((erc20Token) => {
    return (
      erc20Token.token_address.toLowerCase() == ERC20TokenAddress.toLowerCase()
    );
  });

  logMessage(
    LOG_LEVELS.DEBUG,
    "XEN crypto state: " + JSON.stringify(XENCryptoTokenState, null, 2)
  );

  let message = messageTemplate.replace("$NONCE", nonce);
  let signature = await getSignature(message, chainId, userKeys.prv);

  let payload = {
    wallet_address: bitgoMultiSigContractAddress,
    token_address: ERC20TokenAddress,
    switch_value: true,
    balance: XENCryptoTokenState[0].balance,
    chain_id: chainId,
    signing_hash: signature,
    easy_protect_token: false, // Don't activate Easy Protect Mode
    protected_state: "f", // f - Safe Mode. p - Partial Mode
  };
  const response5 = await axios.put(endpoint5, payload, config);
  logMessage(
    LOG_LEVELS.NECESSARY,
    "Apply FailSafe protection on ERC20 token - Response data: " +
      JSON.stringify(response5.data, null, 2)
  );

  // Optional step:- Turn off Safe Mode for an ERC20 token.
  // Uncomment below lines of code if you would like to remove FailSafe protection on a ERC20 token

  /* const endpoint6 = `${failSafeAPIBaseURL}wallets/protected/remove`;
  // Re-fetching the nonce is required, as the old nonce would have been invalidated by Step3
  response4 = await axios.get(endpoint4, config);
  nonce = response4.data.nonce;
  message = messageTemplate.replace("$NONCE", nonce);
  signature = await getSignature(message, chainId, userKeys.prv);

  payload = {
    wallet_address: bitgoMultiSigContractAddress,
    token_address: ERC20TokenAddress,
    chain_id: chainId,
    signing_hash: signature,
  };

  const response6 = await axios.post(endpoint6, payload, config);
  logMessage(
    LOG_LEVELS.NECESSARY,
    "Remove FailSafe protection on ERC20 token - Response data: " +
      JSON.stringify(response6.data, null, 2)
  ); */
}

(async () => {
  await main();
})();
