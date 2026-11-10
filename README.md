# cf-token

Create a Cloudflare **user API token** using the dashboard session already signed in to Chrome. The CLI drives the dashboard through Playwriter and returns the new token on stdout.

## Setup

Use Node.js 22.22.2 or newer on a supported LTS release. Install the [Playwriter Chrome extension](https://playwriter.dev/) and sign in to the [Cloudflare dashboard](https://dash.cloudflare.com/profile/api-tokens) in that profile.

```sh
git clone https://github.com/tika/cf-user-token.git
cd cf-user-token
npm ci
./cf-token.mjs --help
```

## Create a token

```sh
./cf-token.mjs --name 'DNS reporting' \
  --permission 'Zone:DNS:Read' --zone example.com --dry-run
```

Check the summary in Chrome, then remove `--dry-run` to create the token. Repeat `--permission` to add permissions. Use the dashboard's exact group and access labels, such as `User:User Details:Read` or `Account:Workers Scripts:Edit`. Provide a domain for Zone permissions and the dashboard account name for Account permissions. Use `all` only when you intend to include every resource in that scope.

Tokens expire after seven days by default. Run `--help` for the other supported expiry options.

Pipe stdout directly to a secret manager or another trusted process when scripting. For example, if you already use the 2password CLI:

```sh
./cf-token.mjs --name 'DNS reporting' \
  --permission 'Zone:DNS:Read' --zone example.com |
  2password create api-credential --title 'Cloudflare DNS Reporting' --vault Work --stdin
```

Cloudflare shows the secret once. The CLI leaves the dashboard tab open if creation was attempted but the secret could not be returned. Check the tab and token list before retrying.

## TypeScript API

From this repo after `npm ci`, import the built module. The API uses a discriminated union for `account`, `zone`, and `user` policies. Account and zone policies require a matching resource or `{ all: true }`. Permission group names match the dashboard and the API validates them before creation.

```ts
import { previewUserToken, type Options } from './dist/index.js'

const options = {
  name: 'DNS reporting',
  expires: 7,
  policies: [{
    scope: 'zone',
    resource: { zone: 'example.com' },
    permissions: [{ group: 'DNS', access: 'Read' }],
  }],
} satisfies Options

await previewUserToken(options)
// When ready to issue, call createUserToken(options). It returns Promise<string>.
```
