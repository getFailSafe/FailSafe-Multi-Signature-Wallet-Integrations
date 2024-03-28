import dotenv from "dotenv"; // Load environment variables from .env file
dotenv.config({ path: "../.env" });

import { default as axios } from "axios";
import { Eth } from "@bitgo/account-lib";
import { getWeb3Object } from "./helper.js";

import {
  logMessage,
  LOG_LEVELS,
  enableConsoleLog,
  disableConsoleLog,
} from "../common/helper.js";

const failSafeAPIBaseURL = process.env.FAILSAFE_API_BASEURL;
// Your FailSafe API key (make sure to replace it with your actual API key)
const failSafeAPIKey = process.env.FAILSAFE_API_KEY;

export async function performFailSafeLoginSequence() {
  let endpoint = `${failSafeAPIBaseURL}auth/login`;
  const config = {
    headers: {
      "x-api-key": failSafeAPIKey,
    },
  };
  const bitgoMultiSigContractAddress =
    process.env.BITGO_MULTISIG_CONTRACT_ADDRESS; // <Replace this with your BitGo Multi-Signature Hot Wallet Contract address

  const userKeyWalletAddress = process.env.USER_KEY_WALLET_ADDRESS; // We are using the user key wallet address. But backup key wallet address or bitgo wallet address can also be used
  const userKeyPrivateKeyBase58Encoded =
    process.env.USER_KEY_PRIVATE_KEY_BASE58_ENCODED;

  const chainId = parseInt(process.env.CHAIN_ID);
  const walletType = process.env.WALLET_TYPE;

  logMessage(
    LOG_LEVELS.DEBUG,
    "Pass: " + process.env.USER_KEY_PRIVATE_KEY_BASE58_ENCODED
  );

  // Use BitGo account library to get the ethereum wallet address and private key in plain text

  // Wrapping Eth.KeyPair function around disable and enable console logs to prevent it from flooding the console
  disableConsoleLog();

  const userKeys = new Eth.KeyPair({
    prv: userKeyPrivateKeyBase58Encoded,
  }).getKeys();

  enableConsoleLog();

  // Authentication is a 2 step process.

  // Step 1 is to receive the challenge question from the Auth login endpoint

  const response1 = await axios.post(
    endpoint,
    {
      wallet_address: bitgoMultiSigContractAddress,
      wallet_owner: userKeyWalletAddress,
      chain_id: chainId,
      wallet_type: walletType,
    },
    config
  );

  logMessage(
    LOG_LEVELS.DEBUG,
    "Authentication endpoint response1: " +
      JSON.stringify(response1.data, null, 2)
  );

  // Step 2 is to sign the message field in the challenge with one of the signing keys (user wallet private key in this example)
  const web3 = await getWeb3Object(chainId);
  const signedMessage = web3.eth.accounts.sign(
    response1.data.ChallengeParameters.message,
    userKeys.prv
  );
  const response2 = await axios.post(
    endpoint,
    {
      challengeResponse: {
        signature: signedMessage.signature,
        network_id: chainId,
      },
      sessionToken: response1.data.Session,
      wallet_address: bitgoMultiSigContractAddress,
      wallet_owner: userKeyWalletAddress,
      chain_id: chainId,
      wallet_type: walletType,
    },
    config
  );

  // Note down the AccessToken from response2.data. It will be used in Step-3-Turn-on-Safe-Mode-For-ERC20-Asset and Step-5-Withdraw-ERC20-Asset-From-FailSafe-Recovery-Vault
  logMessage(
    LOG_LEVELS.DEBUG,
    "Authentication endpoint response2: " +
      JSON.stringify(response2.data, null, 2)
  );
  logMessage(
    LOG_LEVELS.DEBUG,
    "Access Token: " + response2.data.AuthenticationResult.AccessToken
  );

  return response2.data.AuthenticationResult.AccessToken;
  // @DEV - Read more about FailSafe authentication in this developer tutorial: https://failsafe.stoplight.io/docs/failsafe-sdk/v7fcekl950y75-authentication-integration-guide
}

async function main() {
  await performFailSafeLoginSequence();
}

(async () => {
  await main();
})();
