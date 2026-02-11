export type FreepbxServer = {
  id: string
  label: string
  host: string
  port: number
  rootUsername: string
  webUrl?: string | null
  notes?: string | null
  hasPassword: boolean
  freepbxVersion?: string | null
  cpu?: string | null
  memory?: string | null
  disk?: string | null
  asteriskUptime?: string | null
  firewallStatus?: string | null
  fail2banStatus?: string | null
  openPorts?: string[] | null
  metricsUpdatedAt?: string | null
  endpointsData?: {
    extensions: FreepbxExtension[]
    trunks: FreepbxExtension[]
  } | null
  endpointsUpdatedAt?: string | null
  createdAt?: string
  updatedAt?: string
}

export type FreepbxUser = {
  username: string
  password?: string | null
  isRoot?: boolean
}

export type FreepbxUserList = {
  users: FreepbxUser[]
}

export type FreepbxExtension = {
  number: string
  name: string | null
  status: 'online' | 'offline' | 'unknown'
  sourceIp?: string | null
  sourceIps?: string[] | null
  registrations?: Array<{
    ip: string
    status: 'Avail' | 'Unavail' | 'Unknown' | string
  }> | null
}

export type FreepbxExtensionList = {
  extensions: FreepbxExtension[]
  trunks: FreepbxExtension[]
}

export type FreepbxBulkResult = {
  results: Array<{
    serverId: string
    status: 'success' | 'error'
    message: string
    password?: string
  }>
  password?: string
}

export type FreepbxSystemMetrics = {
  cpu: string
  memory: string
  disk: string
  asteriskUptime: string | null
  firewallStatus: 'active' | 'inactive'
  fail2banStatus: 'active' | 'inactive'
  openPorts?: string[]
}


