import { InformationCircleIcon } from '@heroicons/react/24/outline'
import { ChainLayer, useChainLayers } from '../../hooks/useChainLayers'
import { useNetworksAndSigners } from '../../hooks/useNetworksAndSigners'
import { useAppState } from '../../state'
import { getNetworkName, isNetwork } from '../../util/networks'
import { Tooltip } from '../common/Tooltip'
import { formatAmount, formatUSD } from '../../util/NumberUtils'
import { useNativeCurrency } from '../../hooks/useNativeCurrency'
import { useETHPrice } from '../../hooks/useETHPrice'
import { useGasSummary } from './TransferPanelSummary'
import { useMemo } from 'react'
import { useArbQueryParams } from '../../hooks/useArbQueryParams'
import { constants, utils } from 'ethers'
import { twMerge } from 'tailwind-merge'

const depositGasFeeTooltip = ({
  l1NetworkName,
  l2NetworkName,
  depositToOrbit = false
}: {
  l1NetworkName: string
  l2NetworkName: string
  depositToOrbit?: boolean
}) => ({
  L1: `${l1NetworkName} fees go to Ethereum Validators.`,
  L2: `${
    depositToOrbit ? l1NetworkName : l2NetworkName
  } fees are collected by the chain to cover costs of execution. This is an estimated fee, if the true fee is lower, you'll be refunded.`,
  Orbit: `${l2NetworkName} fees are collected by the chain to cover costs of execution. This is an estimated fee, if the true fee is lower, you'll be refunded.`
})

export function EstimatedGas({ layer }: { layer: 'parent' | 'child' }) {
  const {
    app: { isDepositMode, selectedToken }
  } = useAppState()
  const { l1, l2 } = useNetworksAndSigners()
  const { parentLayer, layer: childLayer } = useChainLayers()
  const { ethToUSD } = useETHPrice()
  const nativeCurrency = useNativeCurrency({ provider: l2.provider })
  const parentChainNativeCurrency = useNativeCurrency({ provider: l1.provider })
  const [{ amount }] = useArbQueryParams()
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
  const isParentLayer = layer === 'parent'
  const { status, estimatedL1GasFees, estimatedL2GasFees } = useGasSummary(
    amountBigNumber,
    selectedToken,
    true
  )
  const l1NetworkName = getNetworkName(l1.network.id)
  const l2NetworkName = getNetworkName(l2.network.id)
  const isBridgingETH = selectedToken === null && !nativeCurrency.isCustom
  const showPrice = isBridgingETH && !isNetwork(l1.network.id).isTestnet
  const gasForLayer = isParentLayer ? parentLayer : childLayer

  const showBreakdown = useMemo(() => {
    if (!isDepositMode && isParentLayer) {
      return false
    }
    return !nativeCurrency.isCustom
  }, [isDepositMode, isParentLayer, nativeCurrency.isCustom])

  const estimatedGasFee = useMemo(() => {
    if (!isDepositMode && !isParentLayer) {
      return estimatedL1GasFees + estimatedL2GasFees
    }
    return isParentLayer ? estimatedL1GasFees : estimatedL2GasFees
  }, [estimatedL1GasFees, estimatedL2GasFees, isDepositMode, isParentLayer])

  const layerGasFeeTooltipContent = (layer: ChainLayer) => {
    if (!isDepositMode) {
      return null
    }

    const { isOrbitChain: isDepositToOrbitChain } = isNetwork(l2.network.id)

    return depositGasFeeTooltip({
      l1NetworkName,
      l2NetworkName,
      depositToOrbit: isDepositToOrbitChain
    })[layer]
  }

  if (!showBreakdown) {
    return null
  }

  if (status !== 'success') {
    return null
  }

  return (
    <div
      className={twMerge(
        'grid rounded-md bg-white/25 px-3 py-2 text-right text-sm font-light text-white',
        showPrice ? 'grid-cols-[2fr_1fr_1fr]' : ' grid-cols-[2fr_1fr]'
      )}
    >
      <div className="flex flex-row items-center gap-1">
        <span className="text-left">Gas fee</span>
        <Tooltip content={layerGasFeeTooltipContent(gasForLayer)}>
          <InformationCircleIcon className="h-4 w-4" />
        </Tooltip>
      </div>
      <span className="text-right tabular-nums">
        {formatAmount(estimatedGasFee, {
          symbol: isDepositMode
            ? parentChainNativeCurrency.symbol
            : nativeCurrency.symbol
        })}
      </span>

      {showPrice && (
        <span className="tabular-nums">
          {formatUSD(ethToUSD(estimatedGasFee))}
        </span>
      )}
    </div>
  )
}
