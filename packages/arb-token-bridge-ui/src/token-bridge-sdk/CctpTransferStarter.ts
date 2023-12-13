import { prepareWriteContract, writeContract } from '@wagmi/core'
import { BigNumber, utils } from 'ethers'
import { ERC20__factory } from '@arbitrum/sdk/dist/lib/abi/factories/ERC20__factory'

import {
  ApproveTokenEstimateGasProps,
  ApproveTokenProps,
  BridgeTransferStarter,
  BridgeTransferStarterProps,
  RequiresTokenApprovalProps,
  SelectedToken,
  TransferProps,
  TransferType
} from './BridgeTransferStarter'
import { formatAmount } from '../util/NumberUtils'
import { fetchPerMessageBurnLimit, getCctpContracts } from './cctp'
import { getChainIdFromProvider, getAddressFromSigner } from './utils'
import { fetchErc20Allowance } from '../util/TokenUtils'
import { TokenMessengerAbi } from '../util/cctp/TokenMessengerAbi'

export type CctpTransferStarterProps = BridgeTransferStarterProps & {
  selectedToken: SelectedToken
}
export class CctpTransferStarter extends BridgeTransferStarter {
  public transferType: TransferType
  public selectedToken: SelectedToken // selectedToken is required in this class

  constructor(props: CctpTransferStarterProps) {
    super(props)
    this.transferType = 'cctp'
    this.selectedToken = props.selectedToken
  }

  public requiresNativeCurrencyApproval = async () => false

  public approveNativeCurrency = async () => {
    return
  }

  public async requiresTokenApproval({
    amount,
    address,
    destinationAddress
  }: RequiresTokenApprovalProps): Promise<boolean> {
    const sourceChainId = await getChainIdFromProvider(this.sourceChainProvider)
    const recipient = destinationAddress ?? address
    const { tokenMessengerContractAddress } = getCctpContracts({
      sourceChainId
    })

    const allowanceForL1Gateway = await fetchErc20Allowance({
      address: this.selectedToken.address,
      provider: this.sourceChainProvider,
      owner: recipient,
      spender: tokenMessengerContractAddress
    })

    // need for approval - allowance exhausted
    if (!allowanceForL1Gateway.gte(amount)) {
      return true
    }

    return false
  }

  public async approveToken({
    signer,
    amount
  }: ApproveTokenProps & { amount: BigNumber }) {
    const sourceChainId = await getChainIdFromProvider(this.sourceChainProvider)

    const { usdcContractAddress, tokenMessengerContractAddress } =
      getCctpContracts({ sourceChainId })

    // approve USDC token for burn
    const contract = ERC20__factory.connect(usdcContractAddress, signer)
    const tx = await contract.functions.approve(
      tokenMessengerContractAddress,
      amount
    )
    return tx
  }

  public async approveTokenEstimateGas({
    signer,
    amount
  }: ApproveTokenEstimateGasProps) {
    const sourceChainId = await getChainIdFromProvider(this.sourceChainProvider)
    const { usdcContractAddress, tokenMessengerContractAddress } =
      getCctpContracts({ sourceChainId })
    const contract = ERC20__factory.connect(usdcContractAddress, signer)
    return await contract.estimateGas.approve(
      tokenMessengerContractAddress,
      amount
    )
  }

  public async transfer({ amount, destinationAddress, signer }: TransferProps) {
    if (!this.selectedToken) throw Error('No token selected') // remove this later by type-checking

    const sourceChainId = await getChainIdFromProvider(this.sourceChainProvider)

    const address = await getAddressFromSigner(signer)

    // cctp has an upper limit for transfer
    const burnLimit = await fetchPerMessageBurnLimit({
      sourceChainId
    })

    if (burnLimit.lte(amount)) {
      const formatedLimit = formatAmount(burnLimit, {
        decimals: this.selectedToken.decimals,
        symbol: 'USDC'
      })
      throw Error(
        `The limit for transfers using CCTP is ${formatedLimit}. Please lower your amount and try again.`
      )
    }

    const recipient = destinationAddress || address

    // burn token on the selected chain to be transferred from cctp contracts to the other chain

    // CCTP uses 32 bytes addresses, while EVEM uses 20 bytes addresses
    const mintRecipient = utils.hexlify(
      utils.zeroPad(recipient, 32)
    ) as `0x${string}`

    const {
      usdcContractAddress,
      tokenMessengerContractAddress,
      targetChainDomain
    } = getCctpContracts({
      sourceChainId
    })

    const config = await prepareWriteContract({
      address: tokenMessengerContractAddress,
      abi: TokenMessengerAbi,
      functionName: 'depositForBurn',
      signer,
      args: [amount, targetChainDomain, mintRecipient, usdcContractAddress]
    })

    const depositForBurnTx = await writeContract(config)

    return {
      transferType: this.transferType,
      status: 'pending',
      sourceChainProvider: this.sourceChainProvider,
      sourceChainTransaction: depositForBurnTx,
      destinationChainProvider: this.destinationChainProvider
    }
  }
}
