import React, { useContext, useEffect, useState } from 'react'
import Input from '@components/inputs/Input'
import useRealm from '@hooks/useRealm'
import { getMintMinAmountAsDecimal } from '@tools/sdk/units'
import { PublicKey } from '@solana/web3.js'
import { precision } from '@utils/formatting'
import useWalletStore from 'stores/useWalletStore'
import { GovernedMultiTypeAccount } from '@utils/tokens'
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
import * as CASTLE_SDK from '@castlefinance/vault-sdk'
import { FriktionSnapshot, VoltSnapshot } from '@friktion-labs/friktion-sdk'

// // // //

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
  const [castleVaults, setCastleVaults] = useState<VoltSnapshot[] | null>(null)

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
    return getCastleDepositInstruction({
      schema,
      form,
      amount: form.amount ?? 0,
      programId,
      connection,
      wallet,
      setFormErrors,
    })
  }

  // TODO - where are we doing to pull this metadata from?
  useEffect(() => {
    // call for the mainnet friktion volts
    const callfriktionRequest = async () => {
      const response = await fetch(
        'https://friktion-labs.github.io/mainnet-tvl-snapshots/friktionSnapshot.json'
      )
      const parsedResponse = (await response.json()) as FriktionSnapshot
      setCastleVaults(parsedResponse.allMainnetVolts as VoltSnapshot[])
    }

    callfriktionRequest()
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
    setMintInfo(form.governedTokenAccount?.mint?.account)
  }, [form.governedTokenAccount])

  const schema = getCastleDepositSchema({ form })

  return (
    <React.Fragment>
      <GovernedAccountSelect
        label="Source account"
        governedAccounts={
          governedTokenAccountsWithoutNfts as GovernedMultiTypeAccount[]
        }
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
        {castleVaults
          ?.filter((x) => !x.isInCircuits)
          .map((value) => (
            <Select.Option key={value.voltVaultId} value={value.voltVaultId}>
              <div className="break-all text-fgd-1 ">
                <div className="mb-2">{`Volt #${value.voltType} - ${
                  value.voltType === 1
                    ? 'Generate Income'
                    : value.voltType === 2
                    ? 'Sustainable Stables'
                    : ''
                } - ${value.underlyingTokenSymbol} - APY: ${value.apy}%`}</div>
                <div className="space-y-0.5 text-xs text-fgd-3">
                  <div className="flex items-center">
                    Deposit Token: {value.depositTokenSymbol}
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
          className="text-blue block text-right"
          href="https://castle.finance"
          target="_blank"
        >
          View destination vault
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
