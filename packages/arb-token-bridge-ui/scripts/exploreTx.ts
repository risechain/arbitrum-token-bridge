import { ethers } from "ethers";
import { L2TransactionReceipt } from '@arbitrum/sdk'

const l1Provider = new ethers.providers.JsonRpcProvider("https://distinguished-greatest-mountain.ethereum-sepolia.quiknode.pro/58b6176715dcedd8df2d8064bdd88cee5f8ad16f")
const l2Provider = new ethers.providers.JsonRpcProvider("http://52.76.240.92:8547")

async function printL2Tx() {
    const tx = "0x612d5d21972b12ff0be0decf0c88083c04f2cac089bcb1417f44dc3260bf1142";
    const txnReceipt = await l2Provider.getTransactionReceipt(tx);
    console.log({txnReceipt})
    const l2TxnReceipt = new L2TransactionReceipt(
        txnReceipt /** <-- ethers-js TransactionReceipt of an arbitrum tx */
    )

    /** Wait 3 minutes: */
    // await new Promise(resolve => setTimeout(resolve, 1000 * 60 * 3000))

    // if dataIsOnL1, sequencer has posted it and it inherits full rollup/L1 security
    const dataIsOnL1 = await l2TxnReceipt.isDataAvailable(l2Provider)
    console.log({dataIsOnL1})
}

printL2Tx();