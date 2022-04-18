import { VaultClient } from '@castlefinance/vault-sdk'
import { AnchorWallet } from '@friktion-labs/friktion-sdk/dist/cjs/src/miscUtils'
import { Provider } from '@project-serum/anchor'
import {
  ProgramAccount,
  Proposal,
  ProposalTransaction,
  RpcContext,
  withExecuteTransaction,
} from '@solana/spl-governance'
import { NATIVE_MINT } from '@solana/spl-token'
import { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js'
import { sendSignedTransaction, signTransaction } from '@utils/send'

// Merge instructions within one Transaction, sign it and execute it
export const executeInstructions = async (
  { connection, wallet, programId, programVersion }: RpcContext,
  proposal: ProgramAccount<Proposal>,
  proposalInstructions: ProgramAccount<ProposalTransaction>[]
) => {
  const instructions: TransactionInstruction[] = []

  await Promise.all(
    proposalInstructions.map((instruction) =>
      // withExecuteTransaction function mutate the given 'instructions' parameter
      withExecuteTransaction(
        instructions,
        programId,
        programVersion,
        proposal.account.governance,
        proposal.pubkey,
        instruction.pubkey,
        [instruction.account.getSingleInstruction()]
      )
    )
  )

  const transaction = new Transaction()

  transaction.add(...instructions)

  // // // // Insert adjacent transaction here

  const provider = new Provider(
    connection,
    (wallet as unknown) as AnchorWallet,
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

  const refreshIx = vaultClient.getRefreshIx()
  const refreshTx = new Transaction().add(refreshIx)

  const signedTransaction = await signTransaction({
    transaction,
    wallet,
    connection,
    signers: [],
  })
  const signedRefreshTx = await signTransaction({
    transaction: refreshTx,
    wallet,
    connection,
    signers: [],
  })

  // // // // Send the transactions

  await sendSignedTransaction({
    signedTransaction: signedRefreshTx,
    connection,
    sendingMessage: 'Executing instruction',
    successMessage: 'Execution finalized',
  })
  await sendSignedTransaction({
    signedTransaction,
    connection,
    sendingMessage: 'Executing instruction',
    successMessage: 'Execution finalized',
  })
}
