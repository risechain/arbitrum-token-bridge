// the conversion layer for making bridge-sdk results compatible with our current ui code

import { BigNumber, utils } from 'ethers'
import dayjs from 'dayjs'
import { TransactionResponse } from '@ethersproject/providers'

import { BridgeTransfer } from '@/token-bridge-sdk/BridgeTransferStarter'
import {
  DepositStatus,
  MergedTransaction,
  WithdrawalStatus
} from '../../state/app/state'
import { Deposit } from '../../hooks/useTransactionHistory'
import { AssetType, ERC20BridgeToken } from '../../hooks/arbTokenBridge.types'
import { Chain } from 'wagmi'
import { NativeCurrency } from '../../hooks/useNativeCurrency'
import { isTeleport } from '@/token-bridge-sdk/teleport'

type SdkToUiConversionProps = {
  bridgeTransfer: BridgeTransfer
  l1Network: Chain
  l2Network: Chain
  selectedToken: ERC20BridgeToken | null
  walletAddress: string
  destinationAddress?: string
  nativeCurrency: NativeCurrency
  amount: BigNumber
}

export const convertBridgeSdkToMergedTransaction = ({
  bridgeTransfer,
  l1Network,
  l2Network,
  selectedToken,
  walletAddress,
  destinationAddress,
  nativeCurrency,
  amount
}: SdkToUiConversionProps): MergedTransaction => {
  const { transferType, sourceChainTransaction: tx } = bridgeTransfer
  const isDeposit =
    transferType.includes('deposit') ||
    isTeleport({
      sourceChainId: Number(l1Network.id),
      destinationChainId: Number(l2Network.id)
    })

  return {
    sender: walletAddress!,
    destination: destinationAddress ?? walletAddress,
    direction: isDeposit ? 'deposit-l1' : 'withdraw',
    status: isDeposit ? 'pending' : WithdrawalStatus.UNCONFIRMED,
    createdAt: dayjs().valueOf(),
    resolvedAt: null,
    txId: bridgeTransfer.sourceChainTransaction.hash,
    asset: selectedToken ? selectedToken.symbol : nativeCurrency.symbol,
    assetType: selectedToken ? AssetType.ERC20 : AssetType.ETH,
    value: utils.formatUnits(
      amount,
      selectedToken ? selectedToken.decimals : nativeCurrency.decimals
    ),
    depositStatus: isDeposit ? DepositStatus.L1_PENDING : undefined,
    uniqueId: null,
    isWithdrawal: !isDeposit,
    blockNum: null,
    tokenAddress: selectedToken ? selectedToken.address : undefined,
    parentChainId: Number(l1Network.id),
    childChainId: Number(l2Network.id)
  } as MergedTransaction
}

export const convertBridgeSdkToPendingDepositTransaction = ({
  bridgeTransfer,
  l1Network,
  l2Network,
  walletAddress,
  selectedToken,
  nativeCurrency,
  amount
}: SdkToUiConversionProps): Deposit => {
  const transaction =
    bridgeTransfer.sourceChainTransaction as TransactionResponse
  return {
    sender: walletAddress!,
    destination: walletAddress,
    status: 'pending',
    txID: transaction.hash,
    assetName: selectedToken ? selectedToken.symbol : nativeCurrency.symbol,
    assetType: selectedToken ? AssetType.ERC20 : AssetType.ETH,
    l1NetworkID: String(l1Network.id),
    l2NetworkID: String(l2Network.id),
    value: utils.formatUnits(
      amount,
      selectedToken ? selectedToken.decimals : nativeCurrency.decimals
    ),
    parentChainId: Number(l1Network.id),
    childChainId: Number(l2Network.id),
    direction: 'deposit',
    type: 'deposit-l1',
    source: 'local_storage_cache',
    timestampCreated: String(transaction.timestamp),
    nonce: transaction.nonce
  } as Deposit
}
