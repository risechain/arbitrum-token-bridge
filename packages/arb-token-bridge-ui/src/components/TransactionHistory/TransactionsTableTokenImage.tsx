import { useMemo } from 'react'
import Image from 'next/image'
import EthereumLogoRoundLight from '@/images/EthereumLogoRoundLight.svg'

import { useTokenLists } from '../../hooks/useTokenLists'
import { ChainId } from '../../util/networks'
import { MergedTransaction } from '../../state/app/state'
import { orbitChains } from '../../util/orbitChainsList'
import { AssetType } from '../../hooks/arbTokenBridge.types'

export const TransactionsTableTokenImage = ({
  tx
}: {
  tx: MergedTransaction
}) => {
  // we need to take token image from mainnet by symbol, some token images don't exists on other networks
  const tokenLists = useTokenLists(ChainId.ArbitrumOne)

  const allTokens = useMemo(() => {
    return tokenLists.data?.map(t => t.tokens).flat() || []
  }, [tokenLists])

  const token = useMemo(() => {
    return allTokens.find(
      t => t.symbol.toLowerCase() === tx.asset.toLowerCase()
    )
  }, [allTokens, tx.asset])

  if (tx.assetType === AssetType.ETH) {
    const orbitChain = orbitChains[tx.childChainId]

    const logoSrc =
      orbitChain && orbitChain.bridgeUiConfig.nativeTokenData?.logoUrl
        ? orbitChain.bridgeUiConfig.nativeTokenData.logoUrl
        : EthereumLogoRoundLight

    return (
      <Image height={20} width={20} alt="Native token logo" src={logoSrc} />
    )
  }

  if (!token || !token.logoURI) {
    return <div className="h-[20px] w-[20px] rounded-full bg-white/20" />
  }

  return (
    // SafeImage is used for token logo, we don't know at buildtime where those images will be loaded from
    // It would throw error if it's loaded from external domains
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="h-[20px]"
      alt={token.symbol + ' logo'}
      src={token.logoURI}
    />
  )
}