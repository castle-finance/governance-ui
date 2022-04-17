import { Keypair, Transaction, TransactionInstruction } from '@solana/web3.js'

import {
  getGovernanceProgramVersion,
  Proposal,
  ProposalTransaction,
} from '@solana/spl-governance'

import { withExecuteTransaction } from '@solana/spl-governance'
import { RpcContext } from '@solana/spl-governance'
import { ProgramAccount } from '@solana/spl-governance'
import {
  sendSignedAndAdjacentTransactions,
  sendTransaction,
  signTransactions,
} from '@utils/send'
import { getCastleRefreshInstruction } from '@utils/instructionTools'
import { WalletAdapter } from '@solana/wallet-adapter-base'

export const executeTransaction = async (
  { connection, wallet, programId }: RpcContext,
  proposal: ProgramAccount<Proposal>,
  instruction: ProgramAccount<ProposalTransaction>
) => {
  const signers: Keypair[] = []
  const instructions: TransactionInstruction[] = []

  // Explicitly request the version before making RPC calls to work around race conditions in resolving
  // the version for RealmInfo
  const programVersion = await getGovernanceProgramVersion(
    connection,
    programId
  )

  await withExecuteTransaction(
    instructions,
    programId,
    programVersion,
    proposal.account.governance,
    proposal.pubkey,
    instruction.pubkey,
    [instruction.account.getSingleInstruction()]
  )

  const transaction = new Transaction()

  transaction.add(...instructions)

  await sendTransaction({
    transaction,
    wallet,
    connection,
    signers,
    sendingMessage: 'Executing instruction',
    successMessage: 'Execution finalized',
  })
}

/**
 * Executes additional non-SPL gov transactions
 */
export const executeTransactionWithAdditional = async (
  { connection, wallet, programId }: RpcContext,
  proposal: ProgramAccount<Proposal>,
  instruction: ProgramAccount<ProposalTransaction>
) => {
  const instructions: TransactionInstruction[] = []

  // Explicitly request the version before making RPC calls to work around race conditions in resolving
  // the version for RealmInfo
  const programVersion = await getGovernanceProgramVersion(
    connection,
    programId
  )

  await withExecuteTransaction(
    instructions,
    programId,
    programVersion,
    proposal.account.governance,
    proposal.pubkey,
    instruction.pubkey,
    [instruction.account.getSingleInstruction()]
  )

  // Proposal transaction
  const transaction = new Transaction().add(...instructions)

  // Non-SPL transaction
  const refreshIx = await getCastleRefreshInstruction({
    connection,
    wallet: (wallet as unknown) as WalletAdapter,
  })
  const refreshTx = new Transaction().add(refreshIx)

  // // // Attempt to send both transactions in the same slot
  const [signedTransaction, signedRefreshTx] = await signTransactions({
    transactionsAndSigners: [
      { transaction: transaction },
      { transaction: refreshTx },
    ],
    wallet,
    connection,
  })

  await sendSignedAndAdjacentTransactions({
    signedTransaction,
    adjacentTransaction: signedRefreshTx,
    connection,
    sendingMessage: 'Executing instruction',
    successMessage: 'Execution finalized',
  })
}
