import React, { useContext, useEffect, useState } from 'react'
import Input from '@components/inputs/Input'
import useRealm from '@hooks/useRealm'
import { getMintMinAmountAsDecimal } from '@tools/sdk/units'
import { PublicKey } from '@solana/web3.js'
import { precision } from '@utils/formatting'
import useWalletStore from 'stores/useWalletStore'
import {
  CastleDepositForm,
  UiInstruction,
} from '@utils/uiTypes/proposalCreationTypes'
import { NewProposalContext } from '../../../new'
import { getCastleDepositSchema } from '@utils/validations'
import useGovernanceAssets from '@hooks/useGovernanceAssets'
import { Governance } from '@solana/spl-governance'
import { ProgramAccount } from '@solana/spl-governance'
import GovernedAccountSelect from '../../GovernedAccountSelect'
import { getCastleDepositInstruction } from '@utils/instructionTools'
import Select from '@components/inputs/Select'

// // // //
// TODO - Pull from config
export enum StrategyTypes {
  maxYield = 'maxYield',
  equalAllocation = 'equalAllocation',
}
export type StrategyType = `${StrategyTypes}`
export interface VaultConfig {
  name: string
  network: 'devnet' | 'mainnet-beta' // ENHANCEMENT - add "mainnet-beta" | "testnet" here - pull this value from `WalletAdapterNetwork` in "@solana/wallet-adapter-base"?
  vault_id: string
  rebalance_threshold: number
  token_label: string // i.e. "SOL"
  token_mint: string // i.e. SOL_MINT
  version: string // i.e "0.1.1"
  strategy_type: StrategyType
}
// // //

const CastleDeposit = ({
  index,
  governance,
}: {
  index: number
  governance: ProgramAccount<Governance> | null
}) => {
  const connection = useWalletStore((s) => s.connection)
  const wallet = useWalletStore((s) => s.current)
  const { realmInfo } = useRealm()
  const { governedTokenAccountsWithoutNfts } = useGovernanceAssets()
  const shouldBeGoverned = index !== 0 && governance
  const programId: PublicKey | undefined = realmInfo?.programId

  // Store CastleDepositForm state
  const [form, setForm] = useState<CastleDepositForm>({
    amount: undefined,
    governedTokenAccount: undefined,
    castleVaultId: '',
    programId: programId?.toString(),
    mintInfo: undefined,
  })

  // TODO - replace VoltSnapshot here with castle-specific alternative
  const [castleVaults, setCastleVaults] = useState<VaultConfig[] | null>(null)

  const [governedAccount, setGovernedAccount] = useState<
    ProgramAccount<Governance> | undefined
  >(undefined)

  const [formErrors, setFormErrors] = useState({})

  const mintMinAmount = form.mintInfo
    ? getMintMinAmountAsDecimal(form.mintInfo)
    : 1

  const currentPrecision = precision(mintMinAmount)
  const { handleSetInstructions } = useContext(NewProposalContext)

  const handleSetForm = ({ propertyName, value }) => {
    setFormErrors({})
    setForm({ ...form, [propertyName]: value })
  }

  const setMintInfo = (value) => {
    setForm({ ...form, mintInfo: value })
  }

  const setAmount = (event) => {
    const value = event.target.value
    handleSetForm({
      value: value,
      propertyName: 'amount',
    })
  }

  const validateAmountOnBlur = () => {
    const value = form.amount

    handleSetForm({
      value: parseFloat(
        Math.max(
          Number(mintMinAmount),
          Math.min(Number(Number.MAX_SAFE_INTEGER), Number(value))
        ).toFixed(currentPrecision)
      ),
      propertyName: 'amount',
    })
  }

  async function getInstruction(): Promise<UiInstruction> {
    // console.log('GETTING IX')
    const ix = await getCastleDepositInstruction({
      schema,
      form,
      amount: form.amount ?? 0,
      programId,
      connection,
      wallet,
      setFormErrors,
    })
    // console.log(ix)
    // console.log(form.governedTokenAccount?.transferAddress?.toString())
    // console.log(form.governedTokenAccount?.mint?.publicKey.toString())
    return ix
  }

  // Grab Castle vault information from config server
  useEffect(() => {
    const getCastleConfig = async () => {
      const response = await fetch('https://configs-api.vercel.app/api/configs')
      console.log(connection.cluster) //  TODO - possible bug here, gives mainnet instead of devnet
      const castleVaults = (await response.json())['devnet'] as VaultConfig[]
      console.log(castleVaults)
      setCastleVaults(castleVaults)
    }
    getCastleConfig()
  }, [])

  useEffect(() => {
    handleSetForm({
      propertyName: 'programId',
      value: programId?.toString(),
    })
  }, [realmInfo?.programId])

  useEffect(() => {
    handleSetInstructions(
      { governedAccount: governedAccount, getInstruction },
      index
    )
  }, [form])

  useEffect(() => {
    setGovernedAccount(form.governedTokenAccount?.governance)
    setMintInfo(form.governedTokenAccount?.extensions.mint?.account)
  }, [form.governedTokenAccount])

  const schema = getCastleDepositSchema({ form })

  return (
    <React.Fragment>
      <GovernedAccountSelect
        label="Source account"
        governedAccounts={governedTokenAccountsWithoutNfts}
        onChange={(value) => {
          handleSetForm({ value, propertyName: 'governedTokenAccount' })
        }}
        value={form.governedTokenAccount}
        error={formErrors['governedTokenAccount']}
        shouldBeGoverned={shouldBeGoverned}
        governance={governance}
      />

      <Select
        label="Castle Vault Destination"
        value={form.castleVaultId}
        placeholder="Please select..."
        onChange={(value) =>
          handleSetForm({ value, propertyName: 'castleVaultId' })
        }
        error={formErrors['castleVaultId']}
      >
        {castleVaults?.map((value) => (
          <Select.Option key={value.vault_id} value={value.vault_id}>
            <div className="break-all text-fgd-1 ">
              <div className="mb-2">{`Vault: ${value.name}`}</div>
              <div className="space-y-0.5 text-xs text-fgd-3">
                <div className="flex items-center">
                  Deposit Token: {value.token_mint}
                </div>
                {/* <div>Capacity: {}</div> */}
              </div>
            </div>
          </Select.Option>
        ))}
      </Select>

      {/* TODO - add link to vault you'll be depositing to */}
      {form.castleVaultId !== '' && (
        <a
          className="text-blue block"
          href="https://castle.finance"
          target="_blank"
          rel="noreferrer"
        >
          View destination vault ↗️
        </a>
      )}

      <Input
        min={mintMinAmount}
        label="Amount"
        value={form.amount}
        type="number"
        onChange={setAmount}
        step={mintMinAmount}
        error={formErrors['amount']}
        onBlur={validateAmountOnBlur}
      />
    </React.Fragment>
  )
}

export default CastleDeposit
