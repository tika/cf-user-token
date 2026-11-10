#!/usr/bin/env node
import { fstatSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { parseArgs } from 'node:util'

import { accessLevels, createUserToken, previewUserToken } from './dist/index.js'

const scopes = [
  {
    name: 'account',
    description: 'Permissions for a Cloudflare account',
    resource: '--account NAME',
    example: 'Account:Workers Scripts:Edit',
  },
  {
    name: 'zone',
    description: 'Permissions for a domain',
    resource: '--zone DOMAIN',
    example: 'Zone:DNS:Read',
  },
  {
    name: 'user',
    description: 'Permissions for the signed-in Cloudflare user',
    resource: null,
    example: 'User:User Details:Read',
  },
]
const permissionReference = 'https://developers.cloudflare.com/fundamentals/api/reference/permissions/'
const scopeHelp = 'Usage: cf-token scopes [--json]'

const help = `Usage: cf-token --name NAME --permission "SCOPE:GROUP:ACCESS" [options]

  cf-token help             Show usage
  cf-token scopes           List scopes, resource flags, and examples
  cf-token scopes --json    List the same metadata as JSON

Repeat --permission to grant multiple permissions. Use Account, Zone, or User
for SCOPE and the dashboard's exact permission group and access labels.

  --account NAME     Restrict Account permissions to this dashboard account
  --zone DOMAIN      Restrict Zone permissions to this domain
  --expires DAYS     7 (default), 30, 90, 365, or never
  --dry-run          Open the dashboard summary without creating a token
  --stdout           Send the token through a pipe to a trusted stdin consumer
  --help             Show this help

Use --account all or --zone all to explicitly grant access to all resources
of that scope.

To issue a token, use --stdout and pipe directly to a trusted consumer.
Keep the token out of chat, logs, and command arguments.

  cf-token --name "DNS reporting" --permission "Zone:DNS:Read" \\
    --zone example.com --stdout | your-secret-consumer`

function listScopes(args) {
  const { values } = parseArgs({
    args,
    options: { json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
  })
  if (values.help) {
    console.log(scopeHelp)
    return
  }
  if (values.json) {
    console.log(JSON.stringify({ scopes, accessLevels, permissionReference }, null, 2))
    return
  }

  console.log('Scopes for --permission "SCOPE:GROUP:ACCESS"\n')
  for (const { name, description, resource, example } of scopes) {
    console.log(`  ${name.padEnd(8)} ${description}`)
    console.log(`           Resource: ${resource ?? 'signed-in user (no flag)'} | Example: "${example}"`)
  }
  console.log(`\nAccess labels: ${accessLevels.join(', ')} (availability varies by group)`)
  console.log(`Permission group reference: ${permissionReference}`)
}

function readOptions(args) {
  const { values } = parseArgs({
    args,
    options: {
      name: { type: 'string' },
      permission: { type: 'string', multiple: true },
      account: { type: 'string' },
      zone: { type: 'string' },
      expires: { type: 'string', default: '7' },
      'dry-run': { type: 'boolean' },
      stdout: { type: 'boolean' },
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
    if (!scopes.some(({ name }) => name === scope) || !group || !accessLevels.includes(access)) {
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
  if (values['dry-run'] && values.stdout) {
    throw new Error('Use either --dry-run or --stdout.')
  }
  return { name: values.name.trim(), policies, expires, dryRun: values['dry-run'], stdout: values.stdout }
}

async function main(args) {
  if (args.length === 0 || (args.length === 1 && args[0] === 'help')) {
    console.log(help)
    return
  }
  if (args[0] === 'scopes') {
    listScopes(args.slice(1))
    return
  }

  const options = readOptions(args)
  if (!options) console.log(help)
  else if (options.dryRun) {
    await previewUserToken(options)
    console.error('Dry run. Review the token summary in Chrome.')
  } else {
    if (!options.stdout || !fstatSync(process.stdout.fd).isFIFO()) {
      throw new Error('Token creation requires --stdout and a pipe to a trusted stdin consumer. See --help.')
    }
    const token = await createUserToken(options)
    try {
      await pipeline(Readable.from([token + '\n']), process.stdout)
    } catch {
      throw new Error('Cloudflare created the token, but delivery through the pipe failed. Check the token list before retrying.')
    }
  }
}

try {
  await main(process.argv.slice(2))
} catch (error) {
  console.error(`cf-token: ${error.message}`)
  process.exitCode = 1
}
