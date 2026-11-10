#!/usr/bin/env node
import { parseArgs } from 'node:util'

import { accessLevels, createUserToken, previewUserToken } from './dist/index.js'

const help = `Usage: cf-token --name NAME --permission "SCOPE:GROUP:ACCESS" [options]

Repeat --permission to grant multiple permissions. Use Account, Zone, or User
for SCOPE and the dashboard's exact permission group and access labels.

  --account NAME     Restrict Account permissions to this dashboard account
  --zone DOMAIN      Restrict Zone permissions to this domain
  --expires DAYS     7 (default), 30, 90, 365, or never
  --dry-run          Open the dashboard summary without creating a token
  --help             Show this help

Use --account all or --zone all to explicitly grant access to all resources
of that scope. On success the token is written to stdout.`

function readOptions() {
  const { values } = parseArgs({
    options: {
      name: { type: 'string' },
      permission: { type: 'string', multiple: true },
      account: { type: 'string' },
      zone: { type: 'string' },
      expires: { type: 'string', default: '7' },
      'dry-run': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  if (values.help) return
  if (!values.name?.trim() || !values.permission?.length) {
    throw new Error('Supply --name and at least one --permission. See --help.')
  }

  const groups = new Map()
  for (const permission of values.permission) {
    const parts = permission.split(':')
    const scope = parts.shift()?.trim().toLowerCase()
    const access = parts.pop()?.trim()
    const group = parts.join(':').trim()
    if (!['account', 'zone', 'user'].includes(scope) || !group || !accessLevels.includes(access)) {
      throw new Error('Use --permission "SCOPE:GROUP:ACCESS", for example "Zone:DNS:Read".')
    }
    if (!groups.has(scope)) groups.set(scope, [])
    groups.get(scope).push({ group, access })
  }

  for (const scope of ['account', 'zone']) {
    if (groups.has(scope) && !values[scope]?.trim()) {
      throw new Error(`Specify --${scope} for its permissions. Use all to select every resource.`)
    }
    if (!groups.has(scope) && values[scope] !== undefined) {
      throw new Error(`--${scope} requires a permission in that scope.`)
    }
  }
  const policies = [...groups].map(([scope, permissions]) => {
    if (scope === 'user') return { scope, permissions }
    const resource = values[scope].trim()
    return { scope, permissions, resource: resource === 'all' ? { all: true } : { [scope]: resource } }
  })
  if (!['7', '30', '90', '365', 'never'].includes(values.expires)) {
    throw new Error('Use --expires 7, 30, 90, 365, or never.')
  }
  const expires = values.expires === 'never' ? 'never' : Number(values.expires)
  return { name: values.name.trim(), policies, expires, dryRun: values['dry-run'] }
}

try {
  const options = readOptions()
  if (!options) console.log(help)
  else if (options.dryRun) {
    await previewUserToken(options)
    console.error('Dry run. Review the token summary in Chrome.')
  } else {
    const token = await createUserToken(options)
    process.stdout.write(`${token}\n`)
  }
} catch (error) {
  console.error(`cf-token: ${error.message}`)
  process.exitCode = 1
}
