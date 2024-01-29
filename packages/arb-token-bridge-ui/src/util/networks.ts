import { L1Network, L2Network, addCustomNetwork } from '@arbitrum/sdk'
import {
  Chain,
  ParentChain,
  l2Networks,
  chains as arbitrumSdkChains,
  parentChains as arbitrumSdkParentChains,
  addCustomChain
} from '@arbitrum/sdk/dist/lib/dataEntities/networks'

import { loadEnvironmentVariableWithFallback } from './index'
import { getBridgeUiConfigForChain } from './bridgeUiConfig'
import { orbitMainnets, orbitTestnets } from './orbitChainsList'

export enum ChainId {
  // L1
  Ethereum = 1,
  // L1 Testnets
  Goerli = 5,
  Local = 1337,
  Sepolia = 11155111,
  // L2
  ArbitrumOne = 42161,
  ArbitrumNova = 42170,
  // L2 Testnets
  ArbitrumGoerli = 421613,
  ArbitrumSepolia = 421614,
  ArbitrumLocal = 412346,
  // Orbit
  StylusTestnet = 23011913
}

const WhitelistChains = [ChainId.ArbitrumLocal, ChainId.Sepolia]

// TODO: when the main branch of SDK supports Orbit chains, we should be able to fetch it from a single object instead
export const getChains = () => {
  const chains = Object.values({
    ...arbitrumSdkChains,
    ...arbitrumSdkParentChains
  })
  return chains.filter(chain => WhitelistChains.includes(chain.chainID))
  // return chains.filter(chain => chain.chainID != 1338)
}

export const customChainLocalStorageKey = 'arbitrum:custom:chains'

export const INFURA_KEY = process.env.NEXT_PUBLIC_INFURA_KEY

if (typeof INFURA_KEY === 'undefined') {
  throw new Error('Infura API key not provided')
}

const MAINNET_INFURA_RPC_URL = `https://mainnet.infura.io/v3/${INFURA_KEY}`
const GOERLI_INFURA_RPC_URL = `https://goerli.infura.io/v3/${INFURA_KEY}`
const SEPOLIA_INFURA_RPC_URL = `https://sepolia.infura.io/v3/${INFURA_KEY}`

export type ChainWithRpcUrl = Chain & {
  rpcUrl: string
  slug?: string
}

export function getBaseChainIdByChainId({
  chainId
}: {
  chainId: number
}): number {
  const chain = arbitrumSdkChains[chainId]

  if (!chain || !chain.partnerChainID) {
    return chainId
  }

  const parentChain = arbitrumSdkParentChains[chain.partnerChainID]

  if (!parentChain) {
    return chainId
  }

  const parentOfParentChain = (parentChain as L2Network).partnerChainID

  if (parentOfParentChain) {
    return parentOfParentChain
  }

  return parentChain.chainID ?? chainId
}

export function getCustomChainsFromLocalStorage(): ChainWithRpcUrl[] {
  const customChainsFromLocalStorage = localStorage.getItem(
    customChainLocalStorageKey
  )

  if (!customChainsFromLocalStorage) {
    return []
  }

  return (JSON.parse(customChainsFromLocalStorage) as ChainWithRpcUrl[])
    .filter(
      // filter again in case local storage is compromised
      chain => !supportedCustomOrbitParentChains.includes(Number(chain.chainID))
    )
    .map(chain => {
      return {
        ...chain,
        // make sure chainID is numeric
        chainID: Number(chain.chainID)
      }
    })
}

export function getCustomChainFromLocalStorageById(chainId: ChainId) {
  const customChains = getCustomChainsFromLocalStorage()

  if (!customChains) {
    return undefined
  }

  return customChains.find(chain => chain.chainID === chainId)
}

export function saveCustomChainToLocalStorage(newCustomChain: ChainWithRpcUrl) {
  const customChains = getCustomChainsFromLocalStorage()

  if (
    customChains.findIndex(chain => chain.chainID === newCustomChain.chainID) >
    -1
  ) {
    // chain already exists
    return
  }

  const newCustomChains = [...getCustomChainsFromLocalStorage(), newCustomChain]
  localStorage.setItem(
    customChainLocalStorageKey,
    JSON.stringify(newCustomChains)
  )
}

export function removeCustomChainFromLocalStorage(chainId: number) {
  const newCustomChains = getCustomChainsFromLocalStorage().filter(
    chain => chain.chainID !== chainId
  )
  localStorage.setItem(
    customChainLocalStorageKey,
    JSON.stringify(newCustomChains)
  )
}

export const supportedCustomOrbitParentChains = [
  ChainId.ArbitrumGoerli,
  ChainId.ArbitrumSepolia
]

export const rpcURLs: { [chainId: number]: string } = {
  // L1
  [ChainId.Ethereum]: loadEnvironmentVariableWithFallback({
    env: process.env.NEXT_PUBLIC_ETHEREUM_RPC_URL,
    fallback: MAINNET_INFURA_RPC_URL
  }),
  // L1 Testnets
  [ChainId.Goerli]: loadEnvironmentVariableWithFallback({
    env: process.env.NEXT_PUBLIC_GOERLI_RPC_URL,
    fallback: GOERLI_INFURA_RPC_URL
  }),
  [ChainId.Sepolia]: loadEnvironmentVariableWithFallback({
    env: process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL,
    fallback: SEPOLIA_INFURA_RPC_URL
  }),
  // L2
  [ChainId.ArbitrumOne]: 'https://arb1.arbitrum.io/rpc',
  [ChainId.ArbitrumNova]: 'https://nova.arbitrum.io/rpc',
  // L2 Testnets
  [ChainId.ArbitrumGoerli]: 'https://goerli-rollup.arbitrum.io/rpc',
  [ChainId.ArbitrumSepolia]: 'https://sepolia-rollup.arbitrum.io/rpc',
  // Orbit Testnets
  [ChainId.StylusTestnet]: 'https://stylus-testnet.arbitrum.io/rpc'
}

export const explorerUrls: { [chainId: number]: string } = {
  // L1
  [ChainId.Ethereum]: 'https://etherscan.io',
  // L1 Testnets
  [ChainId.Goerli]: 'https://goerli.etherscan.io',
  [ChainId.Sepolia]: 'https://sepolia.etherscan.io',
  // L2
  [ChainId.ArbitrumNova]: 'https://nova.arbiscan.io',
  [ChainId.ArbitrumOne]: 'https://arbiscan.io',
  // L2 Testnets
  [ChainId.ArbitrumGoerli]: 'https://goerli.arbiscan.io',
  [ChainId.ArbitrumSepolia]: 'https://sepolia.arbiscan.io',
  // Orbit Testnets
  [ChainId.StylusTestnet]: 'https://stylus-testnet-explorer.arbitrum.io',
  // Devnet
  [ChainId.ArbitrumLocal]: 'http://52.76.240.92:4000'
}

export const getExplorerUrl = (chainId: ChainId) => {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return explorerUrls[chainId] ?? explorerUrls[ChainId.Ethereum]! //defaults to etherscan, can never be null
}

export const getBlockTime = (chainId: ChainId) => {
  const network = arbitrumSdkParentChains[chainId]
  if (!network) {
    throw new Error(`Couldn't get block time. Unexpected chain ID: ${chainId}`)
  }
  return (network as L1Network).blockTime ?? 12
}

export const getConfirmPeriodBlocks = (chainId: ChainId) => {
  const network = l2Networks[chainId] || arbitrumSdkChains[chainId]
  if (!network) {
    throw new Error(
      `Couldn't get confirm period blocks. Unexpected chain ID: ${chainId}`
    )
  }
  return network.confirmPeriodBlocks
}

export const l2ArbReverseGatewayAddresses: { [chainId: number]: string } = {
  [ChainId.ArbitrumOne]: '0xCaD7828a19b363A2B44717AFB1786B5196974D8E',
  [ChainId.ArbitrumNova]: '0xbf544970E6BD77b21C6492C281AB60d0770451F4',
  [ChainId.ArbitrumGoerli]: '0x584d4D9bED1bEb39f02bb51dE07F493D3A5CdaA0'
}

export const l2DaiGatewayAddresses: { [chainId: number]: string } = {
  [ChainId.ArbitrumOne]: '0x467194771dAe2967Aef3ECbEDD3Bf9a310C76C65',
  [ChainId.ArbitrumNova]: '0x10E6593CDda8c58a1d0f14C5164B376352a55f2F'
}

export const l2wstETHGatewayAddresses: { [chainId: number]: string } = {
  [ChainId.ArbitrumOne]: '0x07d4692291b9e30e326fd31706f686f83f331b82'
}

export const l2LptGatewayAddresses: { [chainId: number]: string } = {
  [ChainId.ArbitrumOne]: '0x6D2457a4ad276000A615295f7A80F79E48CcD318'
}

const defaultL1Network: L1Network = {
  blockTime: 10,
  chainID: 1337,
  explorerUrl: '',
  isCustom: true,
  name: 'EthLocal',
  partnerChainIDs: [412346],
  isArbitrum: false
}

const defaultL2Network: ParentChain = {
  chainID: 412346,
  confirmPeriodBlocks: 20,
  ethBridge: {
    bridge: '0xa9d25696a72830c663513f4744b066694fbc03bc',
    inbox: '0xd3af3d17309f499d0c0f7557b194fdb34bbf9acb',
    outbox: '0xb263cD05A1989751Dd2886668C3624AA09c154dd',
    rollup: '0x334404cc7a4984980bbfb24f6881acd71218829a',
    sequencerInbox: '0x9a112fc2529b435c11c3961299554d5ce161c993'
  },
  explorerUrl: '',
  isArbitrum: true,
  isCustom: true,
  name: 'ArbLocal',
  partnerChainID: 11155111,
  partnerChainIDs: [],
  retryableLifetimeSeconds: 604800,
  nitroGenesisBlock: 0,
  nitroGenesisL1Block: 0,
  depositTimeout: 900000,
  tokenBridge: {
    l1CustomGateway: '0x465E43E84bC99b2ef91376AcEC09aF41aAC5663a',
    l1ERC20Gateway: '0x653fEC03522B60DE7f8B0A3ff5b414a917Da0FC8',
    l1GatewayRouter: '0xf20c1f9f777393Fc5fAb6829fC1965D1B29E7963',
    l1MultiCall: '0x64D758eb28CFB17553A8C33D86A0F9420F042A91',
    l1ProxyAdmin: '0xfC4f2a0e92fD2f9D281045fA00f8D2c023066d24',
    l1Weth: '0x5B0D27Fcc5309665c09BA7cDAa28c4A95b633E82',
    l1WethGateway: '0x3032aAd3b1690D3E19608c7952Cf9A96f6Ee9168',
    l2CustomGateway: '0x4b6e58b2930b2e1768580b6C7B4f416d5D615C8E',
    l2ERC20Gateway: '0xE4AadD073390Ce0098Ce4567eDd57e3AE85efA8F',
    l2GatewayRouter: '0xad995045944da625dAd9115d1755e604F1eDCb1c',
    l2Multicall: '0xcb753e31e15AFa714771b0f37d1E79E43A91B8E3',
    l2ProxyAdmin: '0xc555D5c6CF07F0D1e8b314a427274cb089007323',
    l2Weth: '0xF8Ea9a6DEcEfC7336F40b94Ac120feb54d78A823',
    l2WethGateway: '0x7F12e986946016Af2fCDBf5B12a559812556656E'
  }
}

export type RegisterLocalNetworkParams = {
  l1Network: L1Network
  l2Network: L2Network
}

const registerLocalNetworkDefaultParams: RegisterLocalNetworkParams = {
  l1Network: defaultL1Network,
  l2Network: defaultL2Network
}

export const localL1NetworkRpcUrl = loadEnvironmentVariableWithFallback({
  env: process.env.NEXT_PUBLIC_LOCAL_ETHEREUM_RPC_URL,
  fallback: 'http://localhost:8545'
})
export const localL2NetworkRpcUrl = loadEnvironmentVariableWithFallback({
  env: process.env.NEXT_PUBLIC_LOCAL_ARBITRUM_RPC_URL,
  fallback: 'http://localhost:8547'
})

export function registerLocalNetwork(
  params: RegisterLocalNetworkParams = registerLocalNetworkDefaultParams
) {
  const { l1Network, l2Network } = params

  try {
    rpcURLs[l1Network.chainID] = localL1NetworkRpcUrl
    rpcURLs[l2Network.chainID] = localL2NetworkRpcUrl

    addCustomNetwork({ customL1Network: l1Network, customL2Network: l2Network })
    console.log(l2Networks)
  } catch (error: any) {
    console.error(`Failed to register local network: ${error.message}`)
  }
  try {
    addCustomChain({ customParentChain: l1Network, customChain: l2Network })
  } catch (error: any) {
    //
  }
}

export function isNetwork(chainId: ChainId) {
  const customChains = getCustomChainsFromLocalStorage()
  const isMainnetOrbitChain = chainId in orbitMainnets
  const isTestnetOrbitChain = chainId in orbitTestnets

  const isEthereumMainnet = chainId === ChainId.Ethereum

  const isGoerli = chainId === ChainId.Goerli
  const isSepolia = chainId === ChainId.Sepolia
  const isLocal = chainId === ChainId.Local

  const isArbitrumOne = chainId === ChainId.ArbitrumOne
  const isArbitrumNova = chainId === ChainId.ArbitrumNova
  const isArbitrumGoerli = chainId === ChainId.ArbitrumGoerli
  const isArbitrumSepolia = chainId === ChainId.ArbitrumSepolia
  const isArbitrumLocal = chainId === ChainId.ArbitrumLocal

  const isStylusTestnet = chainId === ChainId.StylusTestnet

  const isEthereumMainnetOrTestnet =
    isEthereumMainnet || isGoerli || isSepolia || isLocal

  const isArbitrum =
    isArbitrumOne ||
    isArbitrumNova ||
    isArbitrumGoerli ||
    isArbitrumLocal ||
    isArbitrumSepolia

  const customChainIds = customChains.map(chain => chain.chainID)
  const isCustomOrbitChain = customChainIds.includes(chainId)

  const isTestnet =
    isGoerli ||
    isLocal ||
    isArbitrumGoerli ||
    isArbitrumLocal ||
    isSepolia ||
    isArbitrumSepolia ||
    isCustomOrbitChain ||
    isStylusTestnet ||
    isTestnetOrbitChain

  const isSupported =
    isArbitrumOne ||
    isArbitrumNova ||
    isEthereumMainnet ||
    isGoerli ||
    isArbitrumGoerli ||
    isSepolia ||
    isArbitrumSepolia ||
    isCustomOrbitChain ||
    isMainnetOrbitChain ||
    isTestnetOrbitChain

  return {
    // L1
    isEthereumMainnet,
    isEthereumMainnetOrTestnet,
    // L1 Testnets
    isGoerli,
    isSepolia,
    // L2
    isArbitrum,
    isArbitrumOne,
    isArbitrumNova,
    // L2 Testnets
    isArbitrumGoerli,
    isArbitrumSepolia,
    // Orbit chains
    isOrbitChain: !isEthereumMainnetOrTestnet && !isArbitrum,
    isTestnet,
    // General
    isSupported
  }
}

export function getNetworkName(chainId: number) {
  return getBridgeUiConfigForChain(chainId).network.name
}

export function getSupportedChainIds(
  {
    includeTestnets
  }: {
    includeTestnets: boolean
  } = { includeTestnets: false }
): ChainId[] {
  return getChains()
    .map(chain => chain.chainID)
    .filter(chainId => {
      if (!includeTestnets) {
        return !isNetwork(chainId).isTestnet
      }
      return true
    })
}

export function mapCustomChainToNetworkData(chain: ChainWithRpcUrl) {
  // custom chain details need to be added to various objects to make it work with the UI
  //
  // add RPC
  rpcURLs[chain.chainID] = chain.rpcUrl
  // explorer URL
  explorerUrls[chain.chainID] = chain.explorerUrl
}

function isChildChain(chain: L2Network | ParentChain): chain is L2Network {
  return typeof (chain as L2Network).partnerChainID !== 'undefined'
}

export function getDestinationChainIds(chainId: ChainId): ChainId[] {
  const chains = getChains()
  const arbitrumSdkChain = chains.find(chain => chain.chainID === chainId)

  if (!arbitrumSdkChain) {
    return []
  }

  const parentChainId = isChildChain(arbitrumSdkChain)
    ? arbitrumSdkChain.partnerChainID
    : undefined

  const validDestinationChainIds =
    chains.find(chain => chain.chainID === chainId)?.partnerChainIDs || []

  if (parentChainId) {
    // always make parent chain the first element
    return [parentChainId, ...validDestinationChainIds]
  }

  return validDestinationChainIds
}
