import Web3 from "web3";
import ERC20ABI from "./ERC20ABI.json" assert { type: "json" }; // Trimmed ABI of ERC20 contract ABI
import WalletSimpleABI from "./WalletSimpleABI.json" assert { type: "json" }; // Trimmed ABI of WalletSimple contract ABI
import { ethers, BigNumber } from "ethers";
import * as util from "ethereumjs-util";
import { logMessage, LOG_LEVELS } from "../common/helper.js";

const BN = Web3.utils.BN;

// Used to map chain id to native-prefix. Refer BitGo test script here:- https://github.com/BitGo/eth-multisig-v4/blob/70920c288703a16f7043ce8ba158c901aa0d2218/test/walletSimple.js#L50
// The correct native prefix is required to sign the operationHash
const bitGoWalletChainSpecificImplementationContracts = {
  31337: {
    name: "Eth",
    nativePrefix: "31337",
    nativeBatchPrefix: "31337-Batch",
    tokenPrefix: "31337-ERC20",
    WalletSimple: "EthWalletSimple",
  },
  42220: {
    name: "Celo",
    nativePrefix: "CELO",
    nativeBatchPrefix: "CELO-Batch",
    tokenPrefix: "CELO-ERC20",
    WalletSimple: "CeloWalletSimple",
  },
  137: {
    name: "Polygon",
    nativePrefix: "POLYGON",
    nativeBatchPrefix: "POLYGON-Batch",
    tokenPrefix: "POLYGON-ERC20",
    WalletSimple: "PolygonWalletSimple",
  },
};

/*
 -------
| Params |
 -------

@chainId - One of the 3 supported chain ids - 1, 56 or 137
@failsafeOrchestratorAddress - FailSafe Orchestrator contract address for the blockchain (Polygon, Binance or Ethereum). Check #2 in this FailSafe SDK doc on how to obtain this address for a given chain - https://failsafe.stoplight.io/docs/failsafe-sdk/584l3fwb2ob5x-application-configuration-settings-guide
@erc20TokenAddress - The wrapped native token contract address for the blockchain (WMATIC for polygon, WBNB for Binance and WETH for Ethereum)

*/

export async function getApproveFailSafeOrchestratorTransactionDataField(
  chainId,
  failsafeOrchestratorAddress,
  erc20TokenAddress
) {
  try {
    const web3 = await getWeb3Object(chainId);

    const ERC20Contract = new web3.eth.Contract(ERC20ABI, erc20TokenAddress);
    const maxUint256Val = web3.utils
      .toBN(2)
      .pow(web3.utils.toBN(256))
      .sub(web3.utils.toBN(1));
    logMessage(
      LOG_LEVELS.DEBUG,
      "Signature request params: " +
        JSON.stringify([failsafeOrchestratorAddress, maxUint256Val], null, 2)
    );

    const approveTransactionDataField = await ERC20Contract.methods
      .approve(failsafeOrchestratorAddress, maxUint256Val)
      .encodeABI();

    logMessage(
      LOG_LEVELS.DEBUG,
      "Approve transaction data field: " +
        JSON.stringify(approveTransactionDataField, null, 2)
    );

    return approveTransactionDataField;
  } catch (error) {
    console.error(error);
    return null;
  }
}

/*
 -------
| Params |
 -------

@bitgoMultiSigContractAddress - Contract address of WalletSimple.sol contract. This contract is deployed automatically by BitGo when you create a new multi-signature wallet in BitGo UI
@bitgoUserWalletAddress - ethereum address of `user wallet` key of BitGo multi signature hot wallet
@failsafeOrchestratorAddress - FailSafe Orchestrator contract address for the blockchain (Polygon, Binance or Ethereum). Check #2 in this FailSafe SDK doc on how to obtain this address for a given chain - https://failsafe.stoplight.io/docs/failsafe-sdk/584l3fwb2ob5x-application-configuration-settings-guide
@erc20TokenAddress - The wrapped native token contract address for the blockchain (WMATIC for polygon, WBNB for Binance and WETH for Ethereum)
@chainId - One of the 3 supported chain ids - 1, 56 or 137
@sendMultiSigFunctionParams - The function parameters for sendMultiSig function in WalletSimple.sol contract identified by @bitgoMultiSigContractAddress
@sendMultiSigFunctionParams - has the following schema - { 
    address toAddress,
    uint256 value,
    bytes calldata data,
    uint256 expireTime,
    uint256 sequenceId,
    bytes calldata signature
}

*/

export async function sendMultiSigTransactionToAuthoriseFailSafeOrchestrator(
  bitgoMultiSigContractAddress,
  bitgoUserWalletAddress,
  bitgoUserWalletPrv,
  chainId,
  sendMultiSigFunctionParams
) {
  const web3 = await getWeb3Object(chainId);
  web3.eth.accounts.wallet.add(bitgoUserWalletPrv);

  const BitGoWalletSimpleContract = new web3.eth.Contract(
    WalletSimpleABI,
    bitgoMultiSigContractAddress
  );

  logMessage(
    LOG_LEVELS.DEBUG,
    "Preparing to call sendMultiSig function with parameters: " +
      JSON.stringify(sendMultiSigFunctionParams, null, 2)
  );

  const gasPriceEstimate = await getGasPriceEstimate(web3);

  const sendMultiSigTx = await BitGoWalletSimpleContract.methods
    .sendMultiSig(
      sendMultiSigFunctionParams.toAddress,
      sendMultiSigFunctionParams.value,
      sendMultiSigFunctionParams.data,
      sendMultiSigFunctionParams.expireTime,
      sendMultiSigFunctionParams.sequenceId,
      sendMultiSigFunctionParams.signature
    )
    .send({
      gas: 400000, // Cap at 400k gas units
      from: bitgoUserWalletAddress,
      gasPrice: gasPriceEstimate,
    });

  logMessage(
    LOG_LEVELS.DEBUG,
    "Send multi-sig response: " + JSON.stringify(sendMultiSigTx, null, 2)
  );

  return sendMultiSigTx;
}

/*
 -------
| Params |
 -------

@erc20TokenAddress - The wrapped native token contract address for the blockchain (WMATIC for polygon, WBNB for Binance and WETH for Ethereum)
@erc20TokenCallData - The data field to the `approve` function of the wrapped native token contract identified by @erc20TokenAddress.
@bitGoBackupWalletAddressPrivateKey - The plain text private key of the `backup wallet key` of the BitGo multi-signature wallet
@chainId - One of the 3 supported chain ids - 1, 56 or 137
*/

export async function getParamsForSendMultiSigFunction(
  erc20TokenAddress,
  erc20TokenCallData,
  bitGoBackupWalletAddressPrivateKey,
  chainId,
  expiryTime,
  sequenceId
) {
  const supportedChainIds = Object.keys(
    bitGoWalletChainSpecificImplementationContracts
  ).map((chainIdKeyString) => Number(chainIdKeyString));

  if (!supportedChainIds.includes(chainId)) {
    throw new Error(
      "Chain id " + chainId + " not supported! Supported chain ids are: ",
      supportedChainIds
    );
  }

  const transformedArgs = [
    bitGoWalletChainSpecificImplementationContracts[chainId]["nativePrefix"],
    erc20TokenAddress.toLowerCase(), // See BitGo test script example - https://github.com/BitGo/eth-multisig-v4/blob/70920c288703a16f7043ce8ba158c901aa0d2218/test/walletSimple.js#L338
    BigNumber.from(0),
    Buffer.from(erc20TokenCallData.replace("0x", ""), "hex"),
    BigNumber.from(expiryTime),
    BigNumber.from(sequenceId),
  ];

  logMessage(
    LOG_LEVELS.DEBUG,
    "Transformed args: " + JSON.stringify(transformedArgs, null, 2)
  );

  // The below is the equivalent for solidity code used in WalletSimple.sol's sendMultiSig function - https://github.com/BitGo/eth-multisig-v4/blob/master/contracts/WalletSimple.sol

  /*
    bytes32 operationHash = keccak256(
    abi.encode(getNetworkId(), toAddress, value, data, expireTime, sequenceId)
    );
  */

  /*
    Let's use ethers.js for calculating the operationHash from the function parameters. This method is followed in BitGo.js test scripts. Refer here: https://github.com/BitGo/eth-multisig-v4/blob/70920c288703a16f7043ce8ba158c901aa0d2218/test/helpers.js
    Function name in the test script:- getSha3ForConfirmationTx()
  */

  const abiEncodedMessageParameters = ethers.utils.solidityPack(
    ["string", "address", "uint", "bytes", "uint", "uint"],
    transformedArgs
  );

  const operationHash = ethers.utils.keccak256(abiEncodedMessageParameters);

  logMessage(LOG_LEVELS.DEBUG, "Operation hash: " + operationHash);

  const signature = util.ecsign(
    Buffer.from(operationHash.replace("0x", ""), "hex"),
    Buffer.from(bitGoBackupWalletAddressPrivateKey.replace(/^0x/i, ""), "hex")
  );

  logMessage(
    LOG_LEVELS.DEBUG,
    "Signature: " + JSON.stringify(signature, null, 2)
  );

  return {
    toAddress: erc20TokenAddress,
    value: 0,
    data: erc20TokenCallData,
    expireTime: expiryTime,
    sequenceId: sequenceId,
    signature: serializeSignature(signature), // Serialization is required. As per BitGo SDK test script - https://github.com/BitGo/eth-multisig-v4/blob/70920c288703a16f7043ce8ba158c901aa0d2218/test/walletSimple.js#L354
  };
}

// Taken from BitGo SDK test helpers - https://github.com/BitGo/eth-multisig-v4/blob/70920c288703a16f7043ce8ba158c901aa0d2218/test/helpers.js
function serializeSignature({ r, s, v }) {
  if (typeof v === "bigint") {
    v = Number(v); // Un-safe casting. But required for `Buffer.from([v])` statement in the below line to execute without errors
  }

  return "0x" + Buffer.concat([r, s, Buffer.from([v])]).toString("hex");
}

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

export async function getGasPriceEstimate(web3) {
  // Get the percentage increase from the environment variable
  const increasePercent = parseInt(
    process.env.GAS_PRICE_INCREASE_PERCENT || "30"
  );
  const multiplier = (100 + increasePercent) / 100;

  let gasPrice = await web3.eth.getGasPrice();

  gasPrice = web3.utils
    .toBN(gasPrice)
    .mul(web3.utils.toBN(multiplier * 10)) // multiplied by 10 to manage decimal values
    .div(web3.utils.toBN(10))
    .toString();

  return gasPrice;
}

export async function getNextSequenceId(chainId, bitgoMultiSigContractAddress) {
  const web3 = await getWeb3Object(chainId);

  const BitGoWalletSimpleContract = new web3.eth.Contract(
    WalletSimpleABI,
    bitgoMultiSigContractAddress
  );

  let nextSequenceId = await BitGoWalletSimpleContract.methods
    .getNextSequenceId()
    .call();
  logMessage(
    LOG_LEVELS.DEBUG,
    "Typeof next sequence id: " + typeof nextSequenceId
  );
  logMessage(LOG_LEVELS.DEBUG, "Next sequence id: " + nextSequenceId);
  nextSequenceId = Number(nextSequenceId);
  return nextSequenceId;
}
