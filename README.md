# cf-token

Create a Cloudflare **user API token** using the dashboard session already signed in to Chrome. The CLI drives the dashboard through Playwriter and delivers new tokens through an explicit pipe to a trusted consumer.

## Setup

Use Node.js 22.22.2 or newer on a supported LTS release. Install the [Playwriter Chrome extension](https://playwriter.dev/) and sign in to the [Cloudflare dashboard](https://dash.cloudflare.com/profile/api-tokens) in that profile.

```sh
git clone https://github.com/tika/cf-user-token.git
cd cf-user-token
npm ci
./cf-token.mjs --help
```

## Discover scopes

```sh
cf-token help
cf-token scopes
cf-token scopes --json
```

These commands run without Chrome. Use `scopes --json` for machine-readable scope names, resource flags, example permissions, and access labels. Scope names describe what the permission applies to. Use the [Cloudflare permission reference](https://developers.cloudflare.com/fundamentals/api/reference/permissions/) to find groups and `--dry-run` to validate the exact dashboard labels.

## Create a token

```sh
./cf-token.mjs --name 'DNS reporting' \
  --permission 'Zone:DNS:Read' --zone example.com --dry-run
```

Check the summary in Chrome. Repeat `--permission` to add permissions using the dashboard's exact group and access labels, such as `User:User Details:Read` or `Account:Workers Scripts:Edit`. Provide a domain for Zone permissions and the dashboard account name for Account permissions. Use `all` only when you intend to include every resource in that scope. Tokens expire after seven days by default.

## Deliver the token securely

Before creating a token, choose a trusted program that reads the secret from stdin, such as your secret manager or the program that needs the token. Put `--pipe-to` last, followed by the executable and its arguments.

```sh
cf-token --name 'DNS reporting' \
  --permission 'Zone:DNS:Read' --zone example.com \
  --pipe-to your-secret-consumer
```

The CLI starts the consumer before creating the token, passes the secret on stdin, suppresses the consumer's output, and checks its exit status. A consumer must exit nonzero if it cannot store or use the secret. For a shell pipeline, use `set -o pipefail` and `--stdout | your-secret-consumer`.

**For agents:** Prefer `--pipe-to` and use `--dry-run` until you know the intended scope and secret destination. Keep the secret out of chat, tool output, shell command arguments, and logs. Avoid `tee`, command substitution, and plaintext files.

Cloudflare shows the secret once. If issuance or delivery fails, check the dashboard and the destination before retrying. Revoke any token whose secret was lost or exposed.

## R2 bucket uploads

For S3-compatible uploads to one bucket, use **R2 Object Storage → Manage API Tokens → Object Read & Write → Apply to specific buckets only**. The account-level `Workers R2 Storage:Edit` permission also allows bucket administration. This CLI creates general user API tokens and does not create bucket-scoped R2 credentials. See [Cloudflare R2 authentication](https://developers.cloudflare.com/r2/api/tokens/) for the Access Key ID and Secret Access Key.

## TypeScript API

From this repo after `npm ci`, import the built module. The API uses a discriminated union for `account`, `zone`, and `user` policies. Account and zone policies require a matching resource or `{ all: true }`. Permission group names match the dashboard and the API validates them before creation. The API returns the secret as a string. Pass it directly to your secret store or client and keep it out of logs.

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
// Call createUserToken(options) only when you can pass the result directly to a trusted consumer.
```
