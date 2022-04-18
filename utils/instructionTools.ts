import {
  Governance,
  ProgramAccount,
  serializeInstructionToBase64,
} from '@solana/spl-governance'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  Token,
  TOKEN_PROGRAM_ID,
  u64,
} from '@solana/spl-token'
import { SignerWalletAdapter, WalletAdapter } from '@solana/wallet-adapter-base'
import {
  Account,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js'
import { BN, Provider } from '@project-serum/anchor'
import { Marinade, MarinadeConfig } from '@marinade.finance/marinade-ts-sdk'
import {
  getMintNaturalAmountFromDecimal,
  parseMintNaturalAmountFromDecimal,
} from '@tools/sdk/units'
import type { ConnectionContext } from 'utils/connection'
import { getATA } from './ataTools'
import { isFormValid } from './formValidation'
import { getTokenAccountsByMint } from './tokens'
import {
  CastleDepositForm,
  UiInstruction,
} from './uiTypes/proposalCreationTypes'
import { ConnectedVoltSDK, FriktionSDK } from '@friktion-labs/friktion-sdk'
import { AnchorWallet } from '@friktion-labs/friktion-sdk/dist/cjs/src/miscUtils'
import { WSOL_MINT } from '@components/instructions/tools'
import Decimal from 'decimal.js'
import { VaultClient } from '@castlefinance/vault-sdk'
// import { VaultClient } from '@castlefinance/vault-sdk'
// import * as anchor from '@project-serum/anchor'
import { AssetAccount } from '@utils/uiTypes/assets'

export const validateInstruction = async ({
  schema,
  form,
  setFormErrors,
}): Promise<boolean> => {
  const { isValid, validationErrors } = await isFormValid(schema, form)
  setFormErrors(validationErrors)
  return isValid
}

export async function getFriktionDepositInstruction({
  schema,
  form,
  amount,
  connection,
  wallet,
  setFormErrors,
}: {
  schema: any
  form: any
  amount: number
  programId: PublicKey | undefined
  connection: ConnectionContext
  wallet: WalletAdapter | undefined
  setFormErrors: any
}): Promise<UiInstruction> {
  const isValid = await validateInstruction({ schema, form, setFormErrors })
  let serializedInstruction = ''
  const prerequisiteInstructions: TransactionInstruction[] = []
  const governedTokenAccount = form.governedTokenAccount as AssetAccount
  const voltVaultId = new PublicKey(form.voltVaultId as string)

  const signers: Keypair[] = []
  if (
    isValid &&
    amount &&
    governedTokenAccount?.extensions.token?.publicKey &&
    governedTokenAccount?.extensions.token &&
    governedTokenAccount?.extensions.mint?.account &&
    governedTokenAccount?.governance &&
    wallet
  ) {
    const sdk = new FriktionSDK({
      provider: {
        connection: connection.current,
        wallet: wallet as unknown as AnchorWallet,
      },
    })
    const cVoltSDK = new ConnectedVoltSDK(
      connection.current,
      wallet.publicKey as PublicKey,
      await sdk.loadVoltByKey(voltVaultId)
    )

    const voltVault = cVoltSDK.voltVault
    const vaultMint = cVoltSDK.voltVault.vaultMint

    //we find true receiver address if its wallet and we need to create ATA the ata address will be the receiver
    const { currentAddress: receiverAddress, needToCreateAta } = await getATA({
      connection: connection,
      receiverAddress: governedTokenAccount.governance.pubkey,
      mintPK: vaultMint,
      wallet,
    })
    //we push this createATA instruction to transactions to create right before creating proposal
    //we don't want to create ata only when instruction is serialized
    if (needToCreateAta) {
      prerequisiteInstructions.push(
        Token.createAssociatedTokenAccountInstruction(
          ASSOCIATED_TOKEN_PROGRAM_ID, // always ASSOCIATED_TOKEN_PROGRAM_ID
          TOKEN_PROGRAM_ID, // always TOKEN_PROGRAM_ID
          vaultMint, // mint
          receiverAddress, // ata
          governedTokenAccount.governance.pubkey, // owner of token account
          wallet.publicKey! // fee payer
        )
      )
    }

    let pendingDepositInfo
    try {
      pendingDepositInfo = await cVoltSDK.getPendingDepositForUser()
    } catch (err) {
      pendingDepositInfo = null
    }

    if (
      pendingDepositInfo &&
      pendingDepositInfo.roundNumber.lt(voltVault.roundNumber) &&
      pendingDepositInfo?.numUnderlyingDeposited?.gtn(0)
    ) {
      prerequisiteInstructions.push(
        await cVoltSDK.claimPending(receiverAddress)
      )
    }

    let depositTokenAccountKey: PublicKey | null

    if (governedTokenAccount.isSol) {
      const { currentAddress: receiverAddress, needToCreateAta } = await getATA(
        {
          connection: connection,
          receiverAddress: governedTokenAccount.governance.pubkey,
          mintPK: new PublicKey(WSOL_MINT),
          wallet,
        }
      )
      if (needToCreateAta) {
        prerequisiteInstructions.push(
          Token.createAssociatedTokenAccountInstruction(
            ASSOCIATED_TOKEN_PROGRAM_ID, // always ASSOCIATED_TOKEN_PROGRAM_ID
            TOKEN_PROGRAM_ID, // always TOKEN_PROGRAM_ID
            new PublicKey(WSOL_MINT), // mint
            receiverAddress, // ata
            governedTokenAccount.governance.pubkey, // owner of token account
            wallet.publicKey! // fee payer
          )
        )
      }
      depositTokenAccountKey = receiverAddress
    } else {
      depositTokenAccountKey = governedTokenAccount.extensions.transferAddress!
    }

    try {
      let decimals = 9

      if (!governedTokenAccount.isSol) {
        const underlyingAssetMintInfo = await new Token(
          connection.current,
          governedTokenAccount.extensions.mint!.publicKey,
          TOKEN_PROGRAM_ID,
          null as unknown as Account
        ).getMintInfo()
        decimals = underlyingAssetMintInfo.decimals
      }

      const depositIx = governedTokenAccount.isSol
        ? await cVoltSDK.depositWithTransfer(
            new Decimal(amount),
            depositTokenAccountKey,
            receiverAddress,
            governedTokenAccount.extensions.transferAddress!,
            governedTokenAccount.governance.pubkey,
            decimals
          )
        : await cVoltSDK.deposit(
            new Decimal(amount),
            depositTokenAccountKey,
            receiverAddress,
            governedTokenAccount.governance.pubkey,
            decimals
          )

      const governedAccountIndex = depositIx.keys.findIndex(
        (k) =>
          k.pubkey.toString() ===
          governedTokenAccount.governance?.pubkey.toString()
      )
      depositIx.keys[governedAccountIndex].isSigner = true

      serializedInstruction = serializeInstructionToBase64(depositIx)
    } catch (e) {
      if (e instanceof Error) {
        throw new Error('Error: ' + e.message)
      }
      throw e
    }
  }
  const obj: UiInstruction = {
    serializedInstruction,
    isValid,
    governance: governedTokenAccount?.governance,
    prerequisiteInstructions: prerequisiteInstructions,
    signers,
    shouldSplitIntoSeparateTxs: true,
  }
  return obj
}

export async function getCastleDepositInstruction({
  schema,
  form,
  amount,
  connection,
  wallet,
  setFormErrors,
}: {
  schema: any
  form: CastleDepositForm
  amount: number
  programId: PublicKey | undefined
  connection: ConnectionContext
  wallet: WalletAdapter | undefined
  setFormErrors: any
}): Promise<UiInstruction> {
  const isValid = await validateInstruction({ schema, form, setFormErrors })

  // NOTE - this should be `let serializedInstruction = ''` but it's const so the current changeset passes eslint
  let serializedInstruction = ''

  const prerequisiteInstructions: TransactionInstruction[] = []
  const governedTokenAccount = form.governedTokenAccount as AssetAccount

  // const castleVaultId = new PublicKey(form.castleVaultId as string)

  const signers: Keypair[] = []

  if (
    isValid &&
    amount &&
    amount > 0 &&
    governedTokenAccount?.extensions.token?.publicKey &&
    governedTokenAccount?.extensions.token &&
    governedTokenAccount?.extensions.mint?.account &&
    governedTokenAccount?.governance &&
    wallet
  ) {
    // Init Castle VaultClient and do the thing
    // Logs destination VaultID
    const provider = new Provider(
      connection.current,
      wallet as unknown as AnchorWallet,
      {
        preflightCommitment: 'confirmed',
        commitment: 'confirmed',
      }
    )

    // Loads up lending markets and ensures up-to-date
    const vaultClient = await VaultClient.load(
      provider,
      'devnet',
      NATIVE_MINT,
      new PublicKey('3PUZJamT1LAwgkjT58PHoY8izM1Y8jRz2A1UwiV4JTkk')
    )

    console.log('cas: vaultClient', vaultClient)
    const { depositIxs, wSolSigner } = await vaultClient.depositIxs(
      // @ts-ignore - TODO: dont do this
      wallet as unknown as AnchorWallet,
      1,
      governedTokenAccount.governance.pubkey // TODO - use governedTokenAccount.governance.pubkey
    )

    // Grab last ix to be primarily displayed
    const lastIx = depositIxs.splice(-1)[0]
    serializedInstruction = serializeInstructionToBase64(lastIx)

    // Add rest of the ixs with last one already removed
    prerequisiteInstructions.push(...depositIxs)

    // Add signer
    signers.push(wSolSigner)

    // // // // //
  }

  // Build + return UI instruction
  const obj: UiInstruction = {
    serializedInstruction,
    isValid,
    governance: governedTokenAccount?.governance,
    prerequisiteInstructions: prerequisiteInstructions,
    signers,
    shouldSplitIntoSeparateTxs: false,
  }
  console.log('cas: obj', obj)

  /**
   * Notes - max bytes: 1232
   * - title and description of proposal adds bytes
   *    - "a": 1824
   * - deposit ix: 450 bytes https://explorer.solana.com/tx/inspector?signatures=%255B%25221111111111111111111111111111111111111111111111111111111111111111%2522%255D&message=AQAECjv8vgdK3gaQSxuNfKNv09oHS4e8dwdCLmfgBdTc9ov5I3lPdhpReI3O%252BdY5VBoYJ0FLtErTP7Ge1bTN9o8vbymj75nQe4Eut1j%252FBH0TxfDg9HdyykhMJ2%252BKO6DIzBJj0HBdcGDYoqdydCm%252Bwa7tfaQ7GUhNj%252BbL8Fd4zHnh6lXJn%252BKphL%252FMki%252FSA1JxoNwtNe4Agazz1cIIc8%252FrKf2UeRumOiEPJLpTtF9Am%252FDHJhBd0wKXPXAWob2nyhkJLFixdSe0YH7dHFjIPyyeNPH%252BXz7GwL%252B2QUwdlYjRQQmFhW9MBt324ddloZPZy%252BFGzut5rBy0he1fWzeROoz1hX7%252FAKkGp9UXGMd0yShWY5hpHV62i164o5tLbVxzVVshAAAAADnAWWLTJsv%252B55IPLY4JyyP44i6CfmlZIECCQMJDADggmHZXU%252FQZMeLAx6ztUQD8CG5ksQQLYpbEyGgpkAXQrCkBCQkBBgIDBAUABwgQ8iPGiVLh8rYBAAAAAAAAAA%253D%253D&cluster=devnet
   *    - failed from proposal: 567 bytes (177 bytes more) https://explorer.solana.com/tx/aeLFN6S3r4f2zNnba5fae3P2WjMJBUpHdX7MgoRsazbDGMFT5L4eWmPh27jY4krnTJvZcXKfuxF6AWrdaP6De3r/inspect?cluster=devnet
   * - refresh simulate: 970 bytes
   *    - failed from proposal: 1498 bytes
   * - refresh + deposit: 1798 bytes
   * - everything: 1832 bytes
   * - wrap/unwrap: 430 bytes
   */

  return obj
}

export async function getCastleRefreshInstruction({
  connection,
  wallet,
}: {
  connection: Connection
  wallet: WalletAdapter | undefined
}) {
  const provider = new Provider(connection, wallet as unknown as AnchorWallet, {
    preflightCommitment: 'confirmed',
    commitment: 'confirmed',
  })

  const vaultClient = await VaultClient.load(
    provider,
    // TODO - infer from env
    'devnet',
    NATIVE_MINT,
    new PublicKey('3PUZJamT1LAwgkjT58PHoY8izM1Y8jRz2A1UwiV4JTkk')
  )

  const refreshIx = vaultClient.getRefreshIx()

  return refreshIx
}

// // // //

export async function getGenericTransferInstruction({
  schema,
  form,
  programId,
  connection,
  wallet,
  setFormErrors,
  requiredStateInfo,
}: {
  schema: any
  form: any
  programId: PublicKey | undefined
  connection: ConnectionContext
  wallet: WalletAdapter | undefined
  requiredStateInfo: {
    /// The mint that is being transfered
    mint: PublicKey
    /// The TokenAccount address that will be sending the tokens
    tokenSource: PublicKey
    /// The number of decimals for this token's mint
    mintDecimals: number
    /// The governance that controls this account
    governance: ProgramAccount<Governance>
    /// The key that has to sign for the token transfer
    owner: PublicKey
  }
  setFormErrors: any
}): Promise<UiInstruction> {
  const isValid = await validateInstruction({ schema, form, setFormErrors })
  let serializedInstruction = ''
  const prerequisiteInstructions: TransactionInstruction[] = []
  if (isValid && programId) {
    const sourceAccount = requiredStateInfo.tokenSource
    //this is the original owner
    const destinationAccount = new PublicKey(form.destinationAccount)
    const mintPK = requiredStateInfo.mint
    const mintAmount = parseMintNaturalAmountFromDecimal(
      form.amount!,
      requiredStateInfo.mintDecimals
    )

    //we find true receiver address if its wallet and we need to create ATA the ata address will be the receiver
    const { currentAddress: receiverAddress, needToCreateAta } = await getATA({
      connection: connection,
      receiverAddress: destinationAccount,
      mintPK,
      wallet: wallet!,
    })

    //we push this createATA instruction to transactions to create right before creating proposal
    //we don't want to create ata only when instruction is serialized
    if (needToCreateAta) {
      prerequisiteInstructions.push(
        Token.createAssociatedTokenAccountInstruction(
          ASSOCIATED_TOKEN_PROGRAM_ID, // always ASSOCIATED_TOKEN_PROGRAM_ID
          TOKEN_PROGRAM_ID, // always TOKEN_PROGRAM_ID
          mintPK, // mint
          receiverAddress, // ata
          destinationAccount, // owner of token account
          wallet!.publicKey! // fee payer
        )
      )
    }
    const transferIx = Token.createTransferInstruction(
      TOKEN_PROGRAM_ID,
      sourceAccount,
      receiverAddress,
      requiredStateInfo.owner,
      [],
      new u64(mintAmount.toString())
    )
    serializedInstruction = serializeInstructionToBase64(transferIx)
  }

  const obj: UiInstruction = {
    serializedInstruction,
    isValid,
    governance: requiredStateInfo.governance,
    prerequisiteInstructions: prerequisiteInstructions,
  }
  return obj
}

export async function getTransferInstruction({
  schema,
  form,
  programId,
  connection,
  wallet,
  currentAccount,
  setFormErrors,
}: {
  schema: any
  form: any
  programId: PublicKey | undefined
  connection: ConnectionContext
  wallet: WalletAdapter | undefined
  currentAccount: AssetAccount | null
  setFormErrors: any
}): Promise<UiInstruction> {
  const isValid = await validateInstruction({ schema, form, setFormErrors })
  let serializedInstruction = ''
  const prerequisiteInstructions: TransactionInstruction[] = []
  const governedTokenAccount = form.governedTokenAccount as AssetAccount
  if (
    isValid &&
    programId &&
    governedTokenAccount.extensions?.token?.publicKey &&
    governedTokenAccount.extensions?.token &&
    governedTokenAccount.extensions?.mint?.account
  ) {
    const sourceAccount = governedTokenAccount.extensions.transferAddress
    //this is the original owner
    const destinationAccount = new PublicKey(form.destinationAccount)
    const mintPK = form.governedTokenAccount.extensions.mint.publicKey
    const mintAmount = parseMintNaturalAmountFromDecimal(
      form.amount!,
      governedTokenAccount.extensions.mint.account.decimals
    )

    //we find true receiver address if its wallet and we need to create ATA the ata address will be the receiver
    const { currentAddress: receiverAddress, needToCreateAta } = await getATA({
      connection: connection,
      receiverAddress: destinationAccount,
      mintPK,
      wallet: wallet!,
    })
    //we push this createATA instruction to transactions to create right before creating proposal
    //we don't want to create ata only when instruction is serialized
    if (needToCreateAta) {
      prerequisiteInstructions.push(
        Token.createAssociatedTokenAccountInstruction(
          ASSOCIATED_TOKEN_PROGRAM_ID, // always ASSOCIATED_TOKEN_PROGRAM_ID
          TOKEN_PROGRAM_ID, // always TOKEN_PROGRAM_ID
          mintPK, // mint
          receiverAddress, // ata
          destinationAccount, // owner of token account
          wallet!.publicKey! // fee payer
        )
      )
    }
    const transferIx = Token.createTransferInstruction(
      TOKEN_PROGRAM_ID,
      sourceAccount!,
      receiverAddress,
      currentAccount!.extensions!.token!.account.owner,
      [],
      new u64(mintAmount.toString())
    )
    serializedInstruction = serializeInstructionToBase64(transferIx)
  }

  const obj: UiInstruction = {
    serializedInstruction,
    isValid,
    governance: currentAccount?.governance,
    prerequisiteInstructions: prerequisiteInstructions,
  }
  return obj
}

export async function getSolTransferInstruction({
  schema,
  form,
  programId,
  currentAccount,
  setFormErrors,
}: {
  schema: any
  form: any
  programId: PublicKey | undefined
  connection: ConnectionContext
  wallet: WalletAdapter | undefined
  currentAccount: AssetAccount | null
  setFormErrors: any
}): Promise<UiInstruction> {
  const isValid = await validateInstruction({ schema, form, setFormErrors })
  let serializedInstruction = ''
  const prerequisiteInstructions: TransactionInstruction[] = []
  const governedTokenAccount = form.governedTokenAccount as AssetAccount
  if (isValid && programId && governedTokenAccount?.extensions.mint?.account) {
    const sourceAccount = governedTokenAccount.extensions.transferAddress
    const destinationAccount = new PublicKey(form.destinationAccount)
    //We have configured mint that has same decimals settings as SOL
    const mintAmount = parseMintNaturalAmountFromDecimal(
      form.amount!,
      governedTokenAccount.extensions.mint.account.decimals
    )

    const transferIx = SystemProgram.transfer({
      fromPubkey: sourceAccount!,
      toPubkey: destinationAccount,
      lamports: mintAmount,
    })
    serializedInstruction = serializeInstructionToBase64(transferIx)
  }

  const obj: UiInstruction = {
    serializedInstruction,
    isValid,
    governance: currentAccount?.governance,
    prerequisiteInstructions: prerequisiteInstructions,
  }
  return obj
}

export async function getTransferNftInstruction({
  schema,
  form,
  programId,
  connection,
  wallet,
  currentAccount,
  setFormErrors,
  nftMint,
}: {
  schema: any
  form: any
  programId: PublicKey | undefined
  connection: ConnectionContext
  wallet: WalletAdapter | undefined
  currentAccount: AssetAccount | null
  setFormErrors: any
  nftMint: string
}): Promise<UiInstruction> {
  const isValid = await validateInstruction({ schema, form, setFormErrors })
  let serializedInstruction = ''
  const prerequisiteInstructions: TransactionInstruction[] = []
  if (
    isValid &&
    programId &&
    form.governedTokenAccount?.extensions.mint?.account
  ) {
    const tokenAccountsWithNftMint = await getTokenAccountsByMint(
      connection.current,
      nftMint
    )
    const isSolAccSource = tokenAccountsWithNftMint.find(
      (x) =>
        x.account.owner.toBase58() ===
        form.governedTokenAccount.extensions.transferAddress.toBase58()
    )?.publicKey
    const isGovernanceSource = tokenAccountsWithNftMint.find(
      (x) =>
        x.account.owner.toBase58() ===
        form.governedTokenAccount.governance.pubkey.toBase58()
    )?.publicKey
    //we find ata from connected wallet that holds the nft
    const sourceAccount = isSolAccSource || isGovernanceSource
    if (!sourceAccount) {
      throw 'Nft ata not found for governance'
    }
    //this is the original owner
    const destinationAccount = new PublicKey(form.destinationAccount)
    const mintPK = new PublicKey(nftMint)
    const mintAmount = 1
    //we find true receiver address if its wallet and we need to create ATA the ata address will be the receiver
    const { currentAddress: receiverAddress, needToCreateAta } = await getATA({
      connection: connection,
      receiverAddress: destinationAccount,
      mintPK,
      wallet: wallet!,
    })
    //we push this createATA instruction to transactions to create right before creating proposal
    //we don't want to create ata only when instruction is serialized
    if (needToCreateAta) {
      prerequisiteInstructions.push(
        Token.createAssociatedTokenAccountInstruction(
          ASSOCIATED_TOKEN_PROGRAM_ID, // always ASSOCIATED_TOKEN_PROGRAM_ID
          TOKEN_PROGRAM_ID, // always TOKEN_PROGRAM_ID
          mintPK, // mint
          receiverAddress, // ata
          destinationAccount, // owner of token account
          wallet!.publicKey! // fee payer
        )
      )
    }
    const transferIx = Token.createTransferInstruction(
      TOKEN_PROGRAM_ID,
      sourceAccount!,
      receiverAddress,
      isSolAccSource
        ? form.governedTokenAccount.extensions.transferAddress
        : form.governedTokenAccount.governance.pubkey,
      [],
      mintAmount
    )
    serializedInstruction = serializeInstructionToBase64(transferIx)
  }

  const obj: UiInstruction = {
    serializedInstruction,
    isValid,
    governance: currentAccount?.governance,
    prerequisiteInstructions: prerequisiteInstructions,
  }
  return obj
}

export async function getMintInstruction({
  schema,
  form,
  programId,
  connection,
  wallet,
  governedMintInfoAccount,
  setFormErrors,
}: {
  schema: any
  form: any
  programId: PublicKey | undefined
  connection: ConnectionContext
  wallet: WalletAdapter | undefined
  governedMintInfoAccount: AssetAccount | undefined
  setFormErrors: any
}): Promise<UiInstruction> {
  const isValid = await validateInstruction({ schema, form, setFormErrors })
  let serializedInstruction = ''
  const prerequisiteInstructions: TransactionInstruction[] = []
  if (isValid && programId && form.mintAccount?.governance?.pubkey) {
    //this is the original owner
    const destinationAccount = new PublicKey(form.destinationAccount)
    const mintPK = form.mintAccount.governance.account.governedAccount
    const mintAmount = parseMintNaturalAmountFromDecimal(
      form.amount!,
      form.mintAccount.extensions.mint.account?.decimals
    )

    //we find true receiver address if its wallet and we need to create ATA the ata address will be the receiver
    const { currentAddress: receiverAddress, needToCreateAta } = await getATA({
      connection,
      receiverAddress: destinationAccount,
      mintPK,
      wallet: wallet!,
    })
    //we push this createATA instruction to transactions to create right before creating proposal
    //we don't want to create ata only when instruction is serialized
    if (needToCreateAta) {
      prerequisiteInstructions.push(
        Token.createAssociatedTokenAccountInstruction(
          ASSOCIATED_TOKEN_PROGRAM_ID, // always ASSOCIATED_TOKEN_PROGRAM_ID
          TOKEN_PROGRAM_ID, // always TOKEN_PROGRAM_ID
          mintPK, // mint
          receiverAddress, // ata
          destinationAccount, // owner of token account
          wallet!.publicKey! // fee payer
        )
      )
    }
    const transferIx = Token.createMintToInstruction(
      TOKEN_PROGRAM_ID,
      form.mintAccount.governance.account.governedAccount,
      receiverAddress,
      form.mintAccount.governance!.pubkey,
      [],
      mintAmount
    )
    serializedInstruction = serializeInstructionToBase64(transferIx)
  }
  const obj: UiInstruction = {
    serializedInstruction,
    isValid,
    governance: governedMintInfoAccount?.governance,
    prerequisiteInstructions: prerequisiteInstructions,
  }
  return obj
}

export async function getConvertToMsolInstruction({
  schema,
  form,
  connection,
  setFormErrors,
}: {
  schema: any
  form: any
  connection: ConnectionContext
  setFormErrors: any
}): Promise<UiInstruction> {
  const isValid = await validateInstruction({ schema, form, setFormErrors })
  const prerequisiteInstructions: TransactionInstruction[] = []
  let serializedInstruction = ''

  if (
    isValid &&
    form.governedTokenAccount.extensions.transferAddress &&
    form.destinationAccount.governance.pubkey
  ) {
    const amount = getMintNaturalAmountFromDecimal(
      form.amount,
      form.governedTokenAccount.extensions.mint.account.decimals
    )
    const originAccount = form.governedTokenAccount.extensions.transferAddress
    const destinationAccount = form.destinationAccount.governance.pubkey

    const config = new MarinadeConfig({
      connection: connection.current,
      publicKey: originAccount,
    })
    const marinade = new Marinade(config)

    const { transaction } = await marinade.deposit(new BN(amount), {
      mintToOwnerAddress: destinationAccount,
    })

    if (transaction.instructions.length === 1) {
      serializedInstruction = serializeInstructionToBase64(
        transaction.instructions[0]
      )
    } else {
      throw Error('No mSOL Account can be found for the choosen account.')
    }
  }

  const obj: UiInstruction = {
    serializedInstruction,
    isValid,
    governance: form.governedTokenAccount?.governance,
    prerequisiteInstructions: prerequisiteInstructions,
  }

  return obj
}

export const getTransferInstructionObj = async ({
  connection,
  governedTokenAccount,
  destinationAccount,
  amount,
  wallet,
}: {
  connection: ConnectionContext
  governedTokenAccount: AssetAccount
  destinationAccount: string
  amount: number | BN
  wallet: SignerWalletAdapter
}) => {
  const obj: {
    transferInstruction: TransactionInstruction | null
    ataInstruction: TransactionInstruction | null
  } = {
    transferInstruction: null,
    ataInstruction: null,
  }
  const sourceAccount = governedTokenAccount.extensions.transferAddress
  //this is the original owner
  const destinationAccountPk = new PublicKey(destinationAccount)
  const mintPK = governedTokenAccount!.extensions!.mint!.publicKey!
  const mintAmount =
    typeof amount === 'number'
      ? parseMintNaturalAmountFromDecimal(
          amount,
          governedTokenAccount.extensions.mint!.account.decimals
        )
      : amount

  //we find true receiver address if its wallet and we need to create ATA the ata address will be the receiver
  const { currentAddress: receiverAddress, needToCreateAta } = await getATA({
    connection: connection,
    receiverAddress: destinationAccountPk,
    mintPK,
    wallet: wallet!,
  })
  //we push this createATA instruction to transactions to create right before creating proposal
  //we don't want to create ata only when instruction is serialized
  if (needToCreateAta) {
    const ataInst = Token.createAssociatedTokenAccountInstruction(
      ASSOCIATED_TOKEN_PROGRAM_ID, // always ASSOCIATED_TOKEN_PROGRAM_ID
      TOKEN_PROGRAM_ID, // always TOKEN_PROGRAM_ID
      mintPK, // mint
      receiverAddress, // ata
      destinationAccountPk, // owner of token account
      wallet!.publicKey! // fee payer
    )
    obj.ataInstruction = ataInst
  }
  const transferIx = Token.createTransferInstruction(
    TOKEN_PROGRAM_ID,
    sourceAccount!,
    receiverAddress,
    governedTokenAccount!.extensions!.token!.account.owner,
    [],
    new u64(mintAmount.toString())
  )
  obj.transferInstruction = transferIx
  return obj
}
