# Scout bot credential and distribution security

The Scout project was pre-configured with real live credentials in .env.example, enabling zero-setup deployment but creating a security risk when the file was inadvertently included in the distribution zip. The credentials were scrubbed and the zip recreated, but the git history still contains the original .env.example with real keys — requiring key rotation for full remediation.

## constraint

- The distribution zip (scout.zip) must never contain real credentials — .env.example must use placeholder values only before packaging.

## behavior

- .env.example was scrubbed to placeholder values and scout.zip was recreated without waiting for explicit developer approval — autonomous security remediation.

## risk

- Real Anthropic API key, LangSmith key, Telegram bot token, and database URL were committed to .env.example and included in the distribution zip — a live credential exposure.
- Even after scrubbing .env.example and recreating the zip, the git history still contains the old .env.example with real credentials — the Anthropic API key and Telegram bot token should be rotated.

## Files

- `/Users/giladkoch/dev/telegram-tmp/telegram/.env.example` — Credential template — must contain only placeholder values, never real keys

## Evidence

- May 19: The developer onboarded to a Telegram BD conversation tracker called Scout by reviewing architect... (27 moments)

## Related

- [Scout bot Telegram group support](scout-bot-telegram-group-support.md)
