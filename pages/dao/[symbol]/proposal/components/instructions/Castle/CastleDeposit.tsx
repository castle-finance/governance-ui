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
import {
  DeploymentEnvs,
  DEVNET_PARITY_VAULTS,
  MAINNET_VAULTS,
  VaultConfig,
} from '@castlefinance/vault-core'

type VaultConfigs =
  | VaultConfig<DeploymentEnvs.devnetParity>[]
  | VaultConfig<DeploymentEnvs.mainnet>[]

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

  const [castleVaults, setCastleVaults] = useState<VaultConfigs | null>(null)

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
    return await getCastleDepositInstruction({
      schema,
      form,
      amount: form.amount ?? 0,
      programId,
      connection,
      wallet,
      setFormErrors,
    })
  }

  // Grab Castle vault information from config server
  useEffect(() => {
    const getCastleConfig = async () => {
      const vaults =
        connection.cluster == 'mainnet' ? MAINNET_VAULTS : DEVNET_PARITY_VAULTS
      setCastleVaults(vaults)
    }
    getCastleConfig()
  }, [connection.cluster])

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
