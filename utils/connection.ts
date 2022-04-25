import type { EndpointTypes } from '@models/types'
import { Connection } from '@solana/web3.js'
import type { EndpointInfo } from '../@types/types'

const ENDPOINTS: EndpointInfo[] = [
  {
    name: 'mainnet',
    url:
      process.env.MAINNET_RPC ||
      'https://solana-api.syndica.io/access-token/PBhwkfVgRLe1MEpLI5VbMDcfzXThjLKDHroc31shR5e7qrPqQi9TAUoV6aD3t0pg/rpc/',
  },
  {
    name: 'devnet',
    url:
      process.env.DEVNET_RPC ||
      'https://psytrbhymqlkfrhudd.dev.genesysgo.net:8899',
  },
  {
    name: 'localnet',
    url: 'http://127.0.0.1:8899',
  },
]

console.log('deployed ENDPOINTS:', ENDPOINTS)

export interface ConnectionContext {
  cluster: EndpointTypes
  current: Connection
  endpoint: string
}

export function getConnectionContext(cluster: string): ConnectionContext {
  const ENDPOINT = ENDPOINTS.find((e) => e.name === cluster) || ENDPOINTS[0]
  return {
    cluster: ENDPOINT!.name as EndpointTypes,
    current: new Connection(ENDPOINT!.url, 'recent'),
    endpoint: ENDPOINT!.url,
  }
}

/**
 * Given ConnectionContext, find the network.
 * @param connectionContext
 * @returns EndpointType
 */
export function getNetworkFromEndpoint(endpoint: string) {
  const network = ENDPOINTS.find((e) => e.url === endpoint)
  if (!network) {
    console.log(endpoint, ENDPOINTS)
    throw new Error('Network not found')
  }
  return network?.name
}
