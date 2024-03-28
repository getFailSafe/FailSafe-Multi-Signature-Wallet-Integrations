import "dotenv/config.js"; // Load environment variables from .env file
import { default as axios } from "axios";
import { Eth } from "@bitgo/account-lib";
import { sendMultiSigTransactionToWithdrawERC20Asset } from "./helper.js";
import { logMessage, LOG_LEVELS } from "../common/helper.js";
import { performFailSafeLoginSequence } from "../Step-1-Authentication/index.js";

const failSafeAPIBaseURL = process.env.FAILSAFE_API_BASEURL;
// Your FailSafe API key (make sure to replace it with your actual API key)
const failSafeAPIKey = process.env.FAILSAFE_API_KEY;

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

  // Withdrawing an ERC20 asset from FailSafe Recovery Vault (Smart Contract) is a 4 step process

  // Step 1 is to retrieve balance of ERC20 tokens in the FailSafe Recovery Vault
  const endpoint1 = `${failSafeAPIBaseURL}failsafe/recovery-vault/balances?chain_id=${chainId}`;
  const response1 = await axios.get(endpoint1, config);

  logMessage(
    LOG_LEVELS.NECESSARY,
    "Assets and balances in FailSafe Recovery Vault: " +
      JSON.stringify(response1.data, null, 2)
  );

  // Step 2 is to retrieve FailSafe Recovery Vault Smart Contract linked with the Bitgo multi-signature hot wallet
  const endpoint2 = `${failSafeAPIBaseURL}wallets/failsafewallet?wallet_address=${bitgoMultiSigContractAddress}&chain_id=${chainId}`;
  const response2 = await axios.get(endpoint2, config);
  const failsafeRecoveryVault = response2.data.failsafeWallet;
  logMessage(
    LOG_LEVELS.DEBUG,
    "Recovery Vault Contract Address: " + failsafeRecoveryVault
  );

  // Step 3 is to prepare the payload for FailSafe Recovery Vault (Smart Contract) wrappedWithdraw function. The payload can be obtained from a FailSafe API endpoint
  const ERC20TokenState = response1.data.erc20.filter((erc20Token) => {
    return (
      erc20Token.token_address.toLowerCase() == ERC20TokenAddress.toLowerCase()
    );
  });

  const endpoint3 = `${failSafeAPIBaseURL}failsafe/recovery-vault/withdraw-token`;
  let payload = {
    wallet_address: bitgoMultiSigContractAddress,
    token_contract: ERC20TokenAddress,
    safe_wallet: bitgoMultiSigContractAddress,
    withdraw_amount: ERC20TokenState[0]["balance_in_wei"], // we are withdrawing full balance of XEN token crypto. Partial withdraw is possbile as well. NOTE:- This number needs to be specified in wei units as a hex string
    chain_id: chainId,
    token_interface: "erc20", // erc20 or erc721. we are withdrawing erc20 token
    auth_code: "000000", // Can be any 6 digit number. If 2FA is enabled for this BitGo multi-signature wallet address on FailSafe
  };
  const response3 = await axios.post(endpoint3, payload, config);

  logMessage(LOG_LEVELS.DEBUG, "Payload: " + JSON.stringify(payload, null, 2));

  logMessage(
    LOG_LEVELS.DEBUG,
    "Payload for FailSafe Recovery Vault Wrappedwithdraw function: " +
      JSON.stringify(response3.data, null, 2)
  );

  let wrappedWithdrawFunctionParams = response3.data;

  // Step 4 is to call FailSafe Recovery Vault (Smart Contract) wrappedWithdraw function with the payload obtained from step3

  const withdrawERC20AssetResponse =
    await sendMultiSigTransactionToWithdrawERC20Asset(
      bitgoMultiSigContractAddress,
      userKeyWalletAddress,
      userKeys.prv,
      backupKeys.prv,
      chainId,
      failsafeRecoveryVault,
      wrappedWithdrawFunctionParams
    );

  logMessage(
    LOG_LEVELS.NECESSARY,
    "Response for FailSafe Recovery Vault Wrappedwithdraw: " +
      JSON.stringify(withdrawERC20AssetResponse, null, 2)
  );
}

(async () => {
  await main();
})();
