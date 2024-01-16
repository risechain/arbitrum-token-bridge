import dayjs from 'dayjs'
import { useState, useMemo, useCallback } from 'react'
import Tippy from '@tippyjs/react'
import { BigNumber, constants, utils } from 'ethers'
import { useLatest } from 'react-use'
import { twMerge } from 'tailwind-merge'
import * as Sentry from '@sentry/react'
import { useAccount, useChainId, useSigner } from 'wagmi'
import { ERC20__factory } from '@arbitrum/sdk/dist/lib/abi/factories/ERC20__factory'
import { JsonRpcProvider } from '@ethersproject/providers'
import { Erc20Bridger, EthBridger } from '@arbitrum/sdk'

import { useAppState } from '../../state'
import { getNetworkName, isNetwork } from '../../util/networks'
import { Button } from '../common/Button'
import {
  TokenDepositCheckDialog,
  TokenDepositCheckDialogType
} from './TokenDepositCheckDialog'
import { TokenImportDialog } from './TokenImportDialog'
import { useArbQueryParams } from '../../hooks/useArbQueryParams'
import { useDialog } from '../common/Dialog'
import { TokenApprovalDialog } from './TokenApprovalDialog'
import { WithdrawalConfirmationDialog } from './WithdrawalConfirmationDialog'
import { TransferPanelSummary } from './TransferPanelSummary'
import { useAppContextActions, useAppContextState } from '../App/AppContext'
import { trackEvent, shouldTrackAnalytics } from '../../util/AnalyticsUtils'
import { TransferPanelMain } from './TransferPanelMain'
import { tokenRequiresApprovalOnL2 } from '../../util/L2ApprovalUtils'
import {
  getL2ERC20Address,
  fetchErc20Allowance,
  fetchErc20L1GatewayAddress,
  fetchErc20L2GatewayAddress,
  isTokenArbitrumGoerliNativeUSDC,
  isTokenArbitrumOneNativeUSDC,
  isTokenGoerliUSDC,
  isTokenMainnetUSDC
} from '../../util/TokenUtils'
import { useSwitchNetworkWithConfig } from '../../hooks/useSwitchNetworkWithConfig'
import { useIsConnectedToArbitrum } from '../../hooks/useIsConnectedToArbitrum'
import { useIsConnectedToOrbitChain } from '../../hooks/useIsConnectedToOrbitChain'
import { errorToast, warningToast } from '../common/atoms/Toast'
import { ExternalLink } from '../common/ExternalLink'
import { useAccountType } from '../../hooks/useAccountType'
import { DOCS_DOMAIN, GET_HELP_LINK } from '../../constants'
import {
  AdvancedSettings,
  getDestinationAddressError,
  useDestinationAddressStore
} from './AdvancedSettings'
import { USDCDepositConfirmationDialog } from './USDCDeposit/USDCDepositConfirmationDialog'
import { USDCWithdrawalConfirmationDialog } from './USDCWithdrawal/USDCWithdrawalConfirmationDialog'
import { CustomFeeTokenApprovalDialog } from './CustomFeeTokenApprovalDialog'
import { fetchPerMessageBurnLimit } from '../../hooks/CCTP/fetchCCTPLimits'
import { isUserRejectedError } from '../../util/isUserRejectedError'
import { formatAmount } from '../../util/NumberUtils'
import { getUsdcTokenAddressFromSourceChainId } from '../../state/cctpState'
import { getAttestationHashAndMessageFromReceipt } from '../../util/cctp/getAttestationHashAndMessageFromReceipt'
import { DepositStatus, MergedTransaction } from '../../state/app/state'
import { getContracts, useCCTP } from '../../hooks/CCTP/useCCTP'
import { useNativeCurrency } from '../../hooks/useNativeCurrency'
import { AssetType } from '../../hooks/arbTokenBridge.types'
import { useStyles } from '../../hooks/TransferPanel/useStyles'
import {
  ImportTokenModalStatus,
  getWarningTokenDescription,
  onTxError,
  useTokenFromSearchParams
} from './TransferPanelUtils'
import { useImportTokenModal } from '../../hooks/TransferPanel/useImportTokenModal'
import { useTransferReadiness } from './useTransferReadiness'
import {
  useGasSummary,
  useGasSummaryStore
} from '../../hooks/TransferPanel/useGasSummaryStore'
import { useTransactionHistory } from '../../hooks/useTransactionHistory'
import { useNetworks } from '../../hooks/useNetworks'
import { useNetworksRelationship } from '../../hooks/useNetworksRelationship'

const isAllowedL2 = async ({
  l1TokenAddress,
  l2TokenAddress,
  walletAddress,
  amountNeeded,
  l2Provider
}: {
  l1TokenAddress: string
  l2TokenAddress: string
  walletAddress: string
  amountNeeded: BigNumber
  l2Provider: JsonRpcProvider
}) => {
  const token = ERC20__factory.connect(l2TokenAddress, l2Provider)

  const gatewayAddress = await fetchErc20L2GatewayAddress({
    erc20L1Address: l1TokenAddress,
    l2Provider
  })

  return (await token.allowance(walletAddress, gatewayAddress)).gte(
    amountNeeded
  )
}

const networkConnectionWarningToast = () =>
  warningToast(
    <>
      Network connection issue. Please contact{' '}
      <ExternalLink href={GET_HELP_LINK} className="underline">
        support
      </ExternalLink>
      .
    </>
  )

export function TransferPanel() {
  const { tokenFromSearchParams, setTokenQueryParam } =
    useTokenFromSearchParams()

  const [tokenDepositCheckDialogType, setTokenDepositCheckDialogType] =
    useState<TokenDepositCheckDialogType>('new-token')
  const [importTokenModalStatus, setImportTokenModalStatus] =
    useState<ImportTokenModalStatus>(ImportTokenModalStatus.IDLE)
  const [showSCWalletTooltip, setShowSCWalletTooltip] = useState(false)

  const {
    app: {
      connectionState,
      selectedToken,
      arbTokenBridgeLoaded,
      arbTokenBridge: { eth, token },
      warningTokens
    }
  } = useAppState()
  const { layout } = useAppContextState()
  const { isTransferring } = layout
  const { address: walletAddress, isConnected } = useAccount()
  const { switchNetworkAsync } = useSwitchNetworkWithConfig({
    isSwitchingNetworkBeforeTx: true
  })
  const chainId = useChainId()
  const [networks] = useNetworks()
  const {
    childChain,
    childChainProvider,
    parentChain,
    parentChainProvider,
    isDepositMode
  } = useNetworksRelationship(networks)
  const latestNetworks = useLatest(networks)

  const { isEOA, isSmartContractWallet } = useAccountType()

  const { data: l1Signer } = useSigner({
    chainId: parentChain.id
  })
  const { data: l2Signer } = useSigner({
    chainId: childChain.id
  })

  const { openTransactionHistoryPanel, setTransferring } =
    useAppContextActions()
  const { addPendingTransaction } = useTransactionHistory(walletAddress)

  const { isArbitrumNova } = isNetwork(childChain.id)

  const latestEth = useLatest(eth)
  const latestToken = useLatest(token)

  const isConnectedToArbitrum = useLatest(useIsConnectedToArbitrum())
  const isConnectedToOrbitChain = useLatest(useIsConnectedToOrbitChain())

  const { depositButtonColorClassName, withdrawalButtonColorClassName } =
    useStyles()

  // Link the amount state directly to the amount in query params -  no need of useState
  // Both `amount` getter and setter will internally be using `useArbQueryParams` functions
  const [{ amount }, setQueryParams] = useArbQueryParams()

  const setAmount = useCallback(
    (newAmount: string) => {
      setQueryParams({ amount: newAmount })
    },
    [setQueryParams]
  )

  const { approveForBurn, depositForBurn } = useCCTP({
    sourceChainId: latestNetworks.current.sourceChain.id
  })

  const [tokenImportDialogProps] = useDialog()
  const [tokenCheckDialogProps, openTokenCheckDialog] = useDialog()
  const [tokenApprovalDialogProps, openTokenApprovalDialog] = useDialog()
  const [customFeeTokenApprovalDialogProps, openCustomFeeTokenApprovalDialog] =
    useDialog()
  const [withdrawalConfirmationDialogProps, openWithdrawalConfirmationDialog] =
    useDialog()
  const [
    usdcWithdrawalConfirmationDialogProps,
    openUSDCWithdrawalConfirmationDialog
  ] = useDialog()
  const [
    usdcDepositConfirmationDialogProps,
    openUSDCDepositConfirmationDialog
  ] = useDialog()

  const nativeCurrency = useNativeCurrency({ provider: childChainProvider })

  const [allowance, setAllowance] = useState<BigNumber | null>(null)
  const [isCctp, setIsCctp] = useState(false)

  const { destinationAddress } = useDestinationAddressStore()

  function closeWithResetTokenImportDialog() {
    setTokenQueryParam(undefined)
    setImportTokenModalStatus(ImportTokenModalStatus.CLOSED)
    tokenImportDialogProps.onClose(false)
  }

  function clearAmountInput() {
    // clear amount input on transfer panel
    setAmount('')
  }

  useImportTokenModal({
    importTokenModalStatus,
    connectionState
  })

  const isBridgingANewStandardToken = useMemo(() => {
    const isUnbridgedToken =
      selectedToken !== null && typeof selectedToken.l2Address === 'undefined'

    return isDepositMode && isUnbridgedToken
  }, [isDepositMode, selectedToken])

  async function depositToken() {
    if (!selectedToken) {
      throw new Error('Invalid app state: no selected token')
    }

    function getDialogType(): TokenDepositCheckDialogType | null {
      let type: TokenDepositCheckDialogType | null = null

      if (isBridgingANewStandardToken) {
        type = 'new-token'
      } else {
        const isUserAddedToken =
          selectedToken &&
          selectedToken?.listIds.size === 0 &&
          typeof selectedToken.l2Address === 'undefined'

        if (isUserAddedToken) {
          type = 'user-added-token'
        }
      }

      return type
    }

    // Check if we need to show `TokenDepositCheckDialog` for first-time bridging
    const dialogType = getDialogType()

    if (dialogType) {
      setTokenDepositCheckDialogType(dialogType)

      const waitForInput = openTokenCheckDialog()
      const [confirmed] = await waitForInput()

      if (confirmed) {
        transfer()
      }
    } else {
      transfer()
    }
  }

  async function approveCustomFeeTokenForInbox(): Promise<boolean> {
    if (typeof walletAddress === 'undefined') {
      throw new Error('walletAddress is undefined')
    }

    if (!l1Signer) {
      throw new Error('failed to find signer')
    }

    const ethBridger = await EthBridger.fromProvider(childChainProvider)
    const { l2Network } = ethBridger

    if (typeof l2Network.nativeToken === 'undefined') {
      throw new Error('l2 network does not use custom fee token')
    }

    const customFeeTokenAllowanceForInbox = await fetchErc20Allowance({
      address: l2Network.nativeToken,
      provider: parentChainProvider,
      owner: walletAddress,
      spender: l2Network.ethBridge.inbox
    })

    const amountBigNumber = utils.parseUnits(amount, nativeCurrency.decimals)

    // We want to bridge a certain amount of the custom fee token, so we have to check if the allowance is enough.
    if (!customFeeTokenAllowanceForInbox.gte(amountBigNumber)) {
      const waitForInput = openCustomFeeTokenApprovalDialog()
      const [confirmed] = await waitForInput()

      if (!confirmed) {
        return false
      }

      const approveCustomFeeTokenTx = await ethBridger.approveFeeToken({
        l1Signer
      })
      await approveCustomFeeTokenTx.wait()
    }

    return true
  }

  async function approveCustomFeeTokenForGateway(): Promise<boolean> {
    if (typeof walletAddress === 'undefined') {
      throw new Error('walletAddress is undefined')
    }

    if (!l1Signer) {
      throw new Error('failed to find signer')
    }

    if (!selectedToken) {
      throw new Error('no selected token')
    }

    const erc20Bridger = await Erc20Bridger.fromProvider(childChainProvider)
    const l2Network = erc20Bridger.l2Network

    if (typeof l2Network.nativeToken === 'undefined') {
      throw new Error('l2 network does not use custom fee token')
    }

    const l1Gateway = await fetchErc20L1GatewayAddress({
      erc20L1Address: selectedToken.address,
      l1Provider: parentChainProvider,
      l2Provider: childChainProvider
    })

    const customFeeTokenAllowanceForL1Gateway = await fetchErc20Allowance({
      address: l2Network.nativeToken,
      provider: parentChainProvider,
      owner: walletAddress,
      spender: l1Gateway
    })

    const estimatedL2GasFees = utils.parseUnits(
      String(gasSummary.estimatedL2GasFees),
      nativeCurrency.decimals
    )

    // We want to bridge a certain amount of an ERC-20 token, but the retryable fees on the chain will be paid in the custom fee token
    // We have to check if the allowance is enough to cover the fees
    if (!customFeeTokenAllowanceForL1Gateway.gte(estimatedL2GasFees)) {
      const waitForInput = openCustomFeeTokenApprovalDialog()
      const [confirmed] = await waitForInput()

      if (!confirmed) {
        return false
      }

      const approveCustomFeeTokenTx = await erc20Bridger.approveFeeToken({
        erc20L1Address: selectedToken.address,
        l1Signer
      })
      await approveCustomFeeTokenTx.wait()
    }

    return true
  }

  const amountBigNumber = useMemo(() => {
    try {
      const amountSafe = amount || '0'

      if (selectedToken) {
        return utils.parseUnits(amountSafe, selectedToken.decimals)
      }

      return utils.parseUnits(amountSafe, nativeCurrency.decimals)
    } catch (error) {
      return constants.Zero
    }
  }, [amount, selectedToken, nativeCurrency])

  useGasSummary(amountBigNumber, selectedToken)

  const { gasSummary, gasSummaryStatus } = useGasSummaryStore()

  // SC wallet transfer requests are sent immediately, delay it to give user an impression of a tx sent
  const showDelayedSCTxRequest = () =>
    setTimeout(() => {
      setTransferring(false)
      setShowSCWalletTooltip(true)
    }, 3000)

  const transferCctp = async (type: 'deposits' | 'withdrawals') => {
    if (!selectedToken) {
      return
    }
    if (!walletAddress) {
      return
    }

    try {
      setTransferring(true)
      if (chainId !== networks.sourceChain.id) {
        await switchNetworkAsync?.(networks.sourceChain.id)
      }
    } catch (e) {
      if (isUserRejectedError(e)) {
        return
      }
    } finally {
      setTransferring(false)
    }

    const isDeposit = type === 'deposits'
    const signer = isDeposit ? l1Signer : l2Signer
    if (!signer) {
      throw 'Signer is undefined'
    }

    setTransferring(true)
    const currentChain = latestNetworks.current.sourceChain
    const currentNetworkName = getNetworkName(currentChain.id)
    const isConnectedToTheWrongChain =
      (isDeposit && isConnectedToArbitrum.current) ||
      (!isDeposit && !isConnectedToArbitrum.current)

    if (isConnectedToTheWrongChain) {
      if (shouldTrackAnalytics(currentNetworkName)) {
        trackEvent('Switch Network and Transfer', {
          type: isDeposit ? 'Deposit' : 'Withdrawal',
          tokenSymbol: 'USDC',
          assetType: 'ERC-20',
          accountType: isSmartContractWallet ? 'Smart Contract' : 'EOA',
          network: currentNetworkName,
          amount: Number(amount)
        })
      }
      const switchTargetChainId = latestNetworks.current.sourceChain.id
      try {
        await switchNetworkAsync?.(switchTargetChainId)
      } catch (e) {
        if (isUserRejectedError(e)) {
          return
        }
      }
    }

    try {
      const sourceChainId = latestNetworks.current.sourceChain.id
      const waitForInput = isDeposit
        ? openUSDCDepositConfirmationDialog()
        : openUSDCWithdrawalConfirmationDialog()
      const [confirmed, primaryButtonClicked] = await waitForInput()

      if (!confirmed) {
        return
      }
      if (isDeposit && primaryButtonClicked === 'bridged') {
        // User has selected normal bridge (USDC.e)
        depositToken()
        return
      }

      // CCTP has an upper limit for transfer
      const burnLimit = await fetchPerMessageBurnLimit({
        sourceChainId
      })

      if (burnLimit.lte(amountBigNumber)) {
        const formatedLimit = formatAmount(burnLimit, {
          decimals: selectedToken.decimals,
          symbol: 'USDC'
        })
        errorToast(
          `The limit for transfers using CCTP is ${formatedLimit}. Please lower your amount and try again.`
        )
        return
      }

      const recipient = destinationAddress || walletAddress
      const { usdcContractAddress, tokenMessengerContractAddress } =
        getContracts(sourceChainId)

      const allowance = await fetchErc20Allowance({
        address: usdcContractAddress,
        provider: networks.sourceChainProvider,
        owner: walletAddress,
        spender: tokenMessengerContractAddress
      })

      if (allowance.lt(amountBigNumber)) {
        setAllowance(allowance)
        setIsCctp(true)
        const waitForInput = openTokenApprovalDialog()
        const [confirmed] = await waitForInput()

        if (!confirmed) {
          return
        }

        try {
          if (isSmartContractWallet) {
            showDelayedSCTxRequest()
          }
          const tx = await approveForBurn(amountBigNumber, signer)
          await tx.wait()
        } catch (error) {
          if (isUserRejectedError(error)) {
            return
          }
          Sentry.captureException(error)
          errorToast(
            `USDC approval transaction failed: ${
              (error as Error)?.message ?? error
            }`
          )
          return
        }
      }

      let depositForBurnTx
      try {
        if (isSmartContractWallet) {
          showDelayedSCTxRequest()
        }
        depositForBurnTx = await depositForBurn({
          amount: amountBigNumber,
          signer,
          recipient: destinationAddress || walletAddress
        })
      } catch (error) {
        if (isUserRejectedError(error)) {
          return
        }
        Sentry.captureException(error)
        errorToast(
          `USDC deposit transaction failed: ${
            (error as Error)?.message ?? error
          }`
        )
      }

      if (isSmartContractWallet) {
        // For SCW, we assume that the transaction went through
        if (shouldTrackAnalytics(currentNetworkName)) {
          trackEvent(isDeposit ? 'CCTP Deposit' : 'CCTP Withdrawal', {
            accountType: 'Smart Contract',
            network: currentNetworkName,
            amount: Number(amount),
            complete: false
          })
        }
        return
      }

      if (!depositForBurnTx) {
        return
      }

      if (shouldTrackAnalytics(currentNetworkName)) {
        trackEvent(isDeposit ? 'CCTP Deposit' : 'CCTP Withdrawal', {
          accountType: 'EOA',
          network: currentNetworkName,
          amount: Number(amount),
          complete: false
        })
      }

      const newTransfer: MergedTransaction = {
        txId: depositForBurnTx.hash,
        asset: 'USDC',
        assetType: AssetType.ERC20,
        blockNum: null,
        createdAt: dayjs().valueOf(),
        direction: isDeposit ? 'deposit' : 'withdraw',
        isWithdrawal: !isDeposit,
        resolvedAt: null,
        status: 'pending',
        uniqueId: null,
        value: amount,
        depositStatus: DepositStatus.CCTP_DEFAULT_STATE,
        destination: recipient,
        sender: walletAddress,
        isCctp: true,
        tokenAddress: getUsdcTokenAddressFromSourceChainId(sourceChainId),
        cctpData: {
          sourceChainId,
          attestationHash: null,
          messageBytes: null,
          receiveMessageTransactionHash: null,
          receiveMessageTimestamp: null
        },
        parentChainId: parentChain.id,
        childChainId: childChain.id
      }

      openTransactionHistoryPanel()
      setTransferring(false)
      clearAmountInput()

      const depositTxReceipt = await depositForBurnTx.wait()
      const { messageBytes, attestationHash } =
        getAttestationHashAndMessageFromReceipt(depositTxReceipt)

      if (depositTxReceipt.status === 0) {
        errorToast('USDC deposit transaction failed')
        return
      }

      if (messageBytes && attestationHash) {
        addPendingTransaction(newTransfer)
      }
    } catch (e) {
    } finally {
      setTransferring(false)
      setIsCctp(false)
    }
  }

  const transfer = async () => {
    const signerUndefinedError = 'Signer is undefined'

    try {
      setTransferring(true)
      if (chainId !== networks.sourceChain.id) {
        await switchNetworkAsync?.(networks.sourceChain.id)
      }
    } catch (e) {
      if (isUserRejectedError(e)) {
        return
      }
    } finally {
      setTransferring(false)
    }

    if (!isConnected) {
      return
    }
    if (!walletAddress) {
      return
    }

    const hasBothSigners = l1Signer && l2Signer
    if (isEOA && !hasBothSigners) {
      throw signerUndefinedError
    }

    const destinationAddressError = await getDestinationAddressError({
      destinationAddress,
      isSmartContractWallet
    })
    if (destinationAddressError) {
      console.error(destinationAddressError)
      return
    }

    // SC ETH transfers aren't enabled yet. Safety check, shouldn't be able to get here.
    if (isSmartContractWallet && !selectedToken) {
      console.error("ETH transfers aren't enabled for smart contract wallets.")
      return
    }

    const l2NetworkName = getNetworkName(childChain.id)

    setTransferring(true)

    try {
      if (isDepositMode) {
        if (!l1Signer) {
          throw signerUndefinedError
        }

        const warningToken =
          selectedToken && warningTokens[selectedToken.address.toLowerCase()]
        if (warningToken) {
          const description = getWarningTokenDescription(warningToken.type)
          return window.alert(
            `${selectedToken?.address} is ${description}; it will likely have unusual behavior when deployed as as standard token to Arbitrum. It is not recommended that you deploy it. (See ${DOCS_DOMAIN}/for-devs/concepts/token-bridge/token-bridge-erc20 for more info.)`
          )
        }

        const isParentChainEthereum = isNetwork(
          parentChain.id
        ).isEthereumMainnetOrTestnet
        // Only switch to L1 if the selected L1 network is Ethereum.
        // Or if connected to an Orbit chain as it can't make deposits.
        if (
          (isConnectedToArbitrum.current && isParentChainEthereum) ||
          isConnectedToOrbitChain.current
        ) {
          if (shouldTrackAnalytics(l2NetworkName)) {
            trackEvent('Switch Network and Transfer', {
              type: 'Deposit',
              tokenSymbol: selectedToken?.symbol,
              assetType: selectedToken ? 'ERC-20' : 'ETH',
              accountType: isSmartContractWallet ? 'Smart Contract' : 'EOA',
              network: l2NetworkName,
              amount: Number(amount)
            })
          }
          await switchNetworkAsync?.(latestNetworks.current.sourceChain.id)

          while (
            (isConnectedToArbitrum.current && isParentChainEthereum) ||
            isConnectedToOrbitChain.current ||
            !latestEth.current ||
            !arbTokenBridgeLoaded
          ) {
            await new Promise(r => setTimeout(r, 100))
          }

          await new Promise(r => setTimeout(r, 3000))
        }

        const l1ChainId = latestNetworks.current.sourceChain.id
        const connectedChainId = networks.sourceChain.id
        const l1ChainEqualsConnectedChain = l1ChainId === connectedChainId

        if (!l1ChainEqualsConnectedChain || isConnectedToOrbitChain.current) {
          // Deposit is invalid if the connected chain doesn't match L1...
          // ...or if connected to an Orbit chain, as it can't make deposits.
          return networkConnectionWarningToast()
        }
        if (selectedToken) {
          const { decimals } = selectedToken
          const amountRaw = utils.parseUnits(amount, decimals)

          // check that a registration is not currently in progress
          const l2RoutedAddress = await getL2ERC20Address({
            erc20L1Address: selectedToken.address,
            l1Provider: parentChainProvider,
            l2Provider: childChainProvider
          })

          if (
            selectedToken.l2Address &&
            selectedToken.l2Address.toLowerCase() !==
              l2RoutedAddress.toLowerCase()
          ) {
            alert(
              'Depositing is currently suspended for this token as a new gateway is being registered. Please try again later and contact support if this issue persists.'
            )
            return
          }

          if (nativeCurrency.isCustom) {
            const approved = await approveCustomFeeTokenForGateway()

            if (!approved) {
              return
            }
          }

          const l1GatewayAddress = await fetchErc20L1GatewayAddress({
            erc20L1Address: selectedToken.address,
            l1Provider: parentChainProvider,
            l2Provider: childChainProvider
          })

          const allowanceForL1Gateway = await fetchErc20Allowance({
            address: selectedToken.address,
            provider: parentChainProvider,
            owner: walletAddress,
            spender: l1GatewayAddress
          })

          if (!allowanceForL1Gateway.gte(amountRaw)) {
            setAllowance(allowance)
            const waitForInput = openTokenApprovalDialog()
            const [confirmed] = await waitForInput()

            if (!confirmed) {
              return false
            }
            await latestToken.current.approve({
              erc20L1Address: selectedToken.address,
              l1Signer
            })
          }

          if (isSmartContractWallet) {
            showDelayedSCTxRequest()
            // we can't call this inside the deposit method because tx is executed in an external app
            if (shouldTrackAnalytics(l2NetworkName)) {
              trackEvent('Deposit', {
                tokenSymbol: selectedToken.symbol,
                assetType: 'ERC-20',
                accountType: 'Smart Contract',
                network: l2NetworkName,
                amount: Number(amount)
              })
            }
          }

          await latestToken.current.deposit({
            erc20L1Address: selectedToken.address,
            amount: amountRaw,
            l1Signer,
            destinationAddress,
            txLifecycle: {
              onTxSubmit: () => {
                openTransactionHistoryPanel()
                setTransferring(false)
                clearAmountInput()
                if (
                  !isSmartContractWallet &&
                  shouldTrackAnalytics(l2NetworkName)
                ) {
                  trackEvent('Deposit', {
                    tokenSymbol: selectedToken.symbol,
                    assetType: 'ERC-20',
                    accountType: 'EOA',
                    network: l2NetworkName,
                    amount: Number(amount)
                  })
                }
              },
              onTxError
            }
          })
        } else {
          if (nativeCurrency.isCustom) {
            const approved = await approveCustomFeeTokenForInbox()

            if (!approved) {
              return
            }
          }

          await latestEth.current.deposit({
            amount: utils.parseUnits(amount, nativeCurrency.decimals),
            l1Signer,
            txLifecycle: {
              onTxSubmit: () => {
                openTransactionHistoryPanel()
                setTransferring(false)
                clearAmountInput()
                if (
                  !isSmartContractWallet &&
                  shouldTrackAnalytics(l2NetworkName)
                ) {
                  trackEvent('Deposit', {
                    assetType: 'ETH',
                    accountType: 'EOA',
                    network: l2NetworkName,
                    amount: Number(amount)
                  })
                }
              },
              onTxError
            }
          })
        }
      } else {
        if (!l2Signer) {
          throw signerUndefinedError
        }

        const isConnectedToEthereum =
          !isConnectedToArbitrum.current && !isConnectedToOrbitChain.current
        const { isOrbitChain } = isNetwork(childChain.id)

        if (
          isConnectedToEthereum ||
          (isConnectedToArbitrum.current && isOrbitChain)
        ) {
          if (shouldTrackAnalytics(l2NetworkName)) {
            trackEvent('Switch Network and Transfer', {
              type: 'Withdrawal',
              tokenSymbol: selectedToken?.symbol,
              assetType: selectedToken ? 'ERC-20' : 'ETH',
              accountType: isSmartContractWallet ? 'Smart Contract' : 'EOA',
              network: l2NetworkName,
              amount: Number(amount)
            })
          }
          await switchNetworkAsync?.(latestNetworks.current.sourceChain.id)

          while (
            (!isConnectedToArbitrum.current &&
              !isConnectedToOrbitChain.current) ||
            (isConnectedToArbitrum.current && isOrbitChain) ||
            !latestEth.current ||
            !arbTokenBridgeLoaded
          ) {
            await new Promise(r => setTimeout(r, 100))
          }

          await new Promise(r => setTimeout(r, 3000))
        }

        if (!isSmartContractWallet) {
          const waitForInput = openWithdrawalConfirmationDialog()
          const [confirmed] = await waitForInput()

          if (!confirmed) {
            return
          }
        }

        const l2ChainId = latestNetworks.current.sourceChain.id
        const connectedChainId = networks.sourceChain.id
        if (
          !(l2ChainId && connectedChainId && +l2ChainId === connectedChainId)
        ) {
          return networkConnectionWarningToast()
        }

        if (selectedToken) {
          const { decimals } = selectedToken
          const amountRaw = utils.parseUnits(amount, decimals)

          if (
            tokenRequiresApprovalOnL2(selectedToken.address, l2ChainId) &&
            selectedToken.l2Address
          ) {
            const allowed = await isAllowedL2({
              l1TokenAddress: selectedToken.address,
              l2TokenAddress: selectedToken.l2Address,
              walletAddress,
              amountNeeded: amountRaw,
              l2Provider: latestNetworks.current.sourceChainProvider
            })
            if (!allowed) {
              if (isSmartContractWallet) {
                showDelayedSCTxRequest()
              }

              await latestToken.current.approveL2({
                erc20L1Address: selectedToken.address,
                l2Signer
              })
            }
          }

          if (isSmartContractWallet) {
            showDelayedSCTxRequest()
            // we can't call this inside the withdraw method because tx is executed in an external app
            if (shouldTrackAnalytics(l2NetworkName)) {
              trackEvent('Withdraw', {
                tokenSymbol: selectedToken.symbol,
                assetType: 'ERC-20',
                accountType: 'Smart Contract',
                network: l2NetworkName,
                amount: Number(amount)
              })
            }
          }

          await latestToken.current.withdraw({
            erc20L1Address: selectedToken.address,
            amount: amountRaw,
            l2Signer,
            destinationAddress,
            txLifecycle: {
              onTxSubmit: () => {
                openTransactionHistoryPanel()
                setTransferring(false)
                clearAmountInput()
                if (
                  !isSmartContractWallet &&
                  shouldTrackAnalytics(l2NetworkName)
                ) {
                  trackEvent('Withdraw', {
                    tokenSymbol: selectedToken.symbol,
                    assetType: 'ERC-20',
                    accountType: 'EOA',
                    network: l2NetworkName,
                    amount: Number(amount)
                  })
                }
              },
              onTxError
            }
          })
        } else {
          await latestEth.current.withdraw({
            amount: utils.parseUnits(amount, nativeCurrency.decimals),
            l2Signer,
            txLifecycle: {
              onTxSubmit: () => {
                openTransactionHistoryPanel()
                setTransferring(false)
                clearAmountInput()
                if (
                  !isSmartContractWallet &&
                  shouldTrackAnalytics(l2NetworkName)
                ) {
                  trackEvent('Withdraw', {
                    assetType: 'ETH',
                    accountType: 'EOA',
                    network: l2NetworkName,
                    amount: Number(amount)
                  })
                }
              },
              onTxError
            }
          })
        }
      }
    } catch (ex) {
      console.log(ex)
    } finally {
      setTransferring(false)
    }
  }

  const { transferReady, errorMessage } = useTransferReadiness({
    amount,
    gasSummary: { ...gasSummary, status: gasSummaryStatus }
  })

  return (
    <>
      <TokenApprovalDialog
        {...tokenApprovalDialogProps}
        amount={amount}
        allowance={allowance}
        token={selectedToken}
        isCctp={isCctp}
      />

      {nativeCurrency.isCustom && (
        <CustomFeeTokenApprovalDialog
          {...customFeeTokenApprovalDialogProps}
          customFeeToken={nativeCurrency}
        />
      )}

      <WithdrawalConfirmationDialog
        {...withdrawalConfirmationDialogProps}
        amount={amount}
      />

      <USDCWithdrawalConfirmationDialog
        {...usdcWithdrawalConfirmationDialogProps}
        amount={amount}
      />

      <USDCDepositConfirmationDialog
        {...usdcDepositConfirmationDialogProps}
        amount={amount}
      />

      <div className="flex flex-col bg-white px-6 py-6 shadow-[0px_4px_20px_rgba(0,0,0,0.2)] lg:rounded">
        <TransferPanelMain
          amount={amount}
          setAmount={setAmount}
          errorMessage={errorMessage}
        />
        <AdvancedSettings />
        <TransferPanelSummary
          amount={parseFloat(amount)}
          token={selectedToken}
        />
        <div className="transfer-panel-stats">
          {isDepositMode ? (
            <Button
              variant="primary"
              loading={isTransferring}
              disabled={!transferReady.deposit}
              onClick={() => {
                if (
                  selectedToken &&
                  (isTokenMainnetUSDC(selectedToken.address) ||
                    isTokenGoerliUSDC(selectedToken.address)) &&
                  !isArbitrumNova
                ) {
                  transferCctp('deposits')
                } else if (selectedToken) {
                  depositToken()
                } else {
                  transfer()
                }
              }}
              className={twMerge(
                'w-full bg-eth-dark py-4 text-lg lg:text-2xl',
                depositButtonColorClassName
              )}
            >
              {isSmartContractWallet && isTransferring
                ? 'Sending request...'
                : `Move funds to ${getNetworkName(
                    networks.destinationChain.id
                  )}`}
            </Button>
          ) : (
            <Button
              variant="primary"
              loading={isTransferring}
              disabled={!transferReady.withdrawal}
              onClick={() => {
                if (
                  selectedToken &&
                  (isTokenArbitrumOneNativeUSDC(selectedToken.address) ||
                    isTokenArbitrumGoerliNativeUSDC(selectedToken.address))
                ) {
                  transferCctp('withdrawals')
                } else {
                  transfer()
                }
              }}
              className={twMerge(
                'w-full py-4 text-lg lg:text-2xl',
                withdrawalButtonColorClassName
              )}
            >
              {isSmartContractWallet && isTransferring
                ? 'Sending request...'
                : `Move funds to ${getNetworkName(
                    networks.destinationChain.id
                  )}`}
            </Button>
          )}
        </div>

        {typeof tokenFromSearchParams !== 'undefined' && (
          <TokenImportDialog
            {...tokenImportDialogProps}
            onClose={closeWithResetTokenImportDialog}
            tokenAddress={tokenFromSearchParams}
          />
        )}

        <TokenDepositCheckDialog
          {...tokenCheckDialogProps}
          type={tokenDepositCheckDialogType}
          symbol={selectedToken ? selectedToken.symbol : nativeCurrency.symbol}
        />

        {showSCWalletTooltip && (
          <Tippy
            placement="bottom-end"
            maxWidth="auto"
            onClickOutside={() => setShowSCWalletTooltip(false)}
            theme="orange"
            visible={showSCWalletTooltip}
            content={
              <div className="flex flex-col">
                <span>
                  <b>
                    To continue, please approve tx on your smart contract
                    wallet.
                  </b>
                </span>
                <span>
                  If you have k of n signers, then k of n will need to sign.
                </span>
              </div>
            }
          >
            {/* Override margin coming from Tippy that causes layout disruptions */}
            <div className="!m-0" />
          </Tippy>
        )}
      </div>
    </>
  )
}
