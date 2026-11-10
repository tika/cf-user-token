import { generateKeyPairSync, privateDecrypt } from 'node:crypto'
import type { Page } from 'playwriter'

const dashboard = 'https://dash.cloudflare.com/profile/api-tokens'

const scopeLabels = { account: 'Account', zone: 'Zone', user: 'User' } as const
export type Scope = keyof typeof scopeLabels

export const accessLevels = ['Read', 'Edit', 'Revoke', 'Run', 'Purge'] as const
export type Access = (typeof accessLevels)[number]

const expirationLabels = {
  7: '7 days', 30: '30 days', 90: '90 days', 365: '1 year', never: 'No expiration',
} as const
export type Expiration = keyof typeof expirationLabels

export interface Permission {
  group: string
  access: Access
}

type AllResources = { all: true; account?: never; zone?: never }
type Permissions = readonly [Permission, ...Permission[]]

export type Policy =
  | { scope: 'user'; permissions: Permissions }
  | { scope: 'account'; resource: AllResources | { account: string; all?: never }; permissions: Permissions }
  | { scope: 'zone'; resource: AllResources | { zone: string; all?: never }; permissions: Permissions }

export interface Options {
  name: string
  policies: readonly [Policy, ...Policy[]]
  expires?: Expiration
}

function validate(options: Options) {
  if (!options.name.trim() || !options.policies.length) {
    throw new Error('Supply a name and at least one policy.')
  }
  if (options.expires !== undefined && !Object.hasOwn(expirationLabels, options.expires)) {
    throw new Error('Use an expiry of 7, 30, 90, 365, or never.')
  }
  const seen = new Set<Scope>()
  for (const policy of options.policies) {
    if (!Object.hasOwn(scopeLabels, policy.scope) || seen.has(policy.scope)) {
      throw new Error('Use one policy per scope. Supported scopes are account, zone, and user.')
    }
    seen.add(policy.scope)
    if (!policy.permissions.length || policy.permissions.some(
      ({ group, access }) => !group.trim() || !accessLevels.includes(access),
    )) {
      throw new Error('Provide at least one permission with a dashboard group and valid access level.')
    }
    if (policy.scope === 'user') continue
    const resource = policy.resource
    if (resource?.all === true && resource.account === undefined && resource.zone === undefined) continue
    if (policy.scope === 'account' && policy.resource?.all === undefined &&
        policy.resource.account?.trim() && policy.resource.account !== 'All accounts') continue
    if (policy.scope === 'zone' && policy.resource?.all === undefined && policy.resource.zone?.trim()) continue
    throw new Error(`Provide a specific ${policy.scope} or explicitly set all: true.`)
  }
}

async function buildSummary(page: Page, options: Options) {
  const role = (type: Parameters<Page['getByRole']>[0], name: string) => page.getByRole(type, { name, exact: true })
  await page.goto(dashboard, { waitUntil: 'domcontentloaded', timeout: 20000 })
  try {
    await role('heading', 'User API Tokens').waitFor()
  } catch {
    throw new Error('Could not open User API Tokens. Check that this Chrome profile is signed in to Cloudflare.')
  }
  await role('button', 'Create Token').click()
  const name = role('textbox', 'Token name')
  await name.click()
  await name.fill(options.name)

  let first = true
  for (const policy of options.policies) {
    const scope = scopeLabels[policy.scope]
    if (first) {
      await page.getByRole('button', { name: /^Start from scratch/ }).click()
      const article = scope === 'Account' ? 'an' : 'a'
      await role('menuitem', `Start with ${article} ${scope} policy`).click()
      first = false
    } else {
      await role('button', 'Add new policy').click()
      await role('menuitem', `Add new ${scope} policy`).click()
    }
    await role('heading', `Edit ${scope} policy`).waitFor()

    if (policy.scope === 'account') {
      await role('combobox', 'Account').click()
      await role('option', policy.resource.all === true ? 'All accounts' : policy.resource.account).click()
    }
    if (policy.scope === 'zone') {
      await role('combobox', 'Resource type').click()
      await role('option', policy.resource.all === true ? 'All zones' : 'Specific zone').click()
      if (policy.resource.all !== true) {
        const zone = role('combobox', 'Zone')
        await zone.click()
        await zone.fill(policy.resource.zone)
        await role('option', policy.resource.zone).click()
      }
    }
    const search = role('textbox', 'Search for permission groups...')
    for (const permission of policy.permissions) {
      const label = `${permission.group}, ${scope}, ${permission.access}`
      await search.click()
      await search.fill(permission.group)
      try {
        await role('checkbox', label).check()
      } catch {
        throw new Error(`Could not select permission "${label}". Check its exact dashboard labels and availability.`)
      }
    }
  }
  await role('button', expirationLabels[options.expires ?? 7]).click()
  await page.getByTestId('api_tokens_summary_button').click()
  await role('heading', 'Token Summary').waitFor()
}

async function readToken(page: Page, publicKey: JsonWebKey, name: string) {
  // Return ciphertext through Playwriter so its CDP trace does not capture the token.
  const result = await page.waitForFunction(async ({ publicKey, name }) => {
    if (location.origin !== 'https://dash.cloudflare.com' ||
        location.pathname !== '/profile/api-tokens') return false
    const visibleText = document.body.innerText
    if (!visibleText.includes('API token was successfully created')) return false
    const fields = Array.from(document.querySelectorAll('input[readonly], textarea[readonly]'))
      .filter((field): field is HTMLInputElement | HTMLTextAreaElement =>
        (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) &&
        field.getClientRects().length > 0)
      .map(field => field.value)
    const matches = new Set([visibleText, ...fields].join('\n')
      .match(/(?<![A-Za-z0-9_-])cfut_[A-Za-z0-9_-]{41,}/g))
    for (const match of matches) {
      if (name.includes(match)) matches.delete(match)
    }
    if (matches.size !== 1) return false
    const [token] = matches

    const key = await crypto.subtle.importKey('jwk', publicKey, {
      name: 'RSA-OAEP', hash: 'SHA-256',
    }, false, ['encrypt'])
    const bytes = await crypto.subtle.encrypt('RSA-OAEP', key, new TextEncoder().encode(token))
    return btoa(String.fromCharCode(...new Uint8Array(bytes)))
  }, { publicKey, name }, { timeout: 20000, polling: 300 })
  return Buffer.from((await result.jsonValue()) as string, 'base64')
}

export async function previewUserToken(options: Options): Promise<void> {
  await run(options, true)
}

export async function createUserToken(options: Options): Promise<string> {
  return run(options, false)
}

function run(options: Options, dryRun: true): Promise<void>
function run(options: Options, dryRun: false): Promise<string>
async function run(options: Options, dryRun: boolean): Promise<string | void> {
  validate(options)
  const { connectViaExtension } = await import('playwriter')
  const connection = await connectViaExtension({ tabGroup: 'cloudflare', closeTabsOnEnd: false })
  let page: Page | undefined
  let keepTab = false
  try {
    const [context] = connection.browser.contexts()
    if (!context) throw new Error('Playwriter could not open the Chrome profile.')
    page = await context.newPage()
    page.setDefaultTimeout(10000)
    await buildSummary(page, options)
    if (dryRun) {
      keepTab = true
      return
    }

    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const create = page.getByRole('button', { name: 'Create Token', exact: true })
    await create.waitFor()
    const url = new URL(page.url())
    if (url.origin + url.pathname !== dashboard) {
      throw new Error('Cloudflare navigated away from User API Tokens.')
    }

    keepTab = true
    try {
      await create.click()
      const ciphertext = await readToken(page, publicKey.export({ format: 'jwk' }), options.name)
      const token = privateDecrypt({ key: privateKey, oaepHash: 'sha256' }, ciphertext)
      keepTab = false
      return token.toString('utf8')
    } catch {
      throw new Error('Could not retrieve the token after attempting creation. Check the Chrome tab before rerunning. Cloudflare may already have created it.')
    }
  } finally {
    try {
      if (!keepTab) await page?.close().catch(() => {})
    } finally {
      await connection.close().catch(() => {})
    }
  }
}
