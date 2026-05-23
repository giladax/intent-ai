# Scout bot Telegram group support

Scout requires specific Telegram platform configuration to function in group chats. Bots cannot join groups via @mention — they must be added by a group admin. Privacy mode (enabled by default) blocks bots from seeing regular group messages and must be disabled via BotFather. Critically, privacy mode changes only take effect for groups joined after the change, requiring a remove-and-re-add cycle. The bot detects group additions via a my_chat_member handler.

## structure

- A my_chat_member handler was added to handlers.ts and allowed_updates was configured in bot.ts to detect when the bot is added to a group — enabling group greeting behavior.

## constraint

- Bots cannot join Telegram groups via @mention — they must be manually added by a group admin. This is a Telegram platform constraint, not a code limitation, and is now documented in README.md and DESIGN.md.

## behavior

- Telegram privacy mode is enabled by default for bots and blocks them from seeing regular group messages. Disabling it via BotFather only takes effect for groups the bot joins after the change — existing groups require the bot to be removed and re-added.

## risk

- Privacy mode misconfiguration is a silent failure mode — the bot appears to run normally but never triggers digestion because group messages never arrive. This was the root cause of digestion never triggering during the live demo.

## interface

- To onboard a new CEO or user, their numeric Telegram user ID (e.g. 5412299567) must be set as CEO_CHAT_ID in .env — obtainable via @userinfobot or bot logs.

## Files

- `/Users/giladkoch/dev/telegram-tmp/telegram/docs/DESIGN.md` — Documents the manual group-add constraint as a known limitation
- `/Users/giladkoch/dev/telegram-tmp/telegram/README.md` — Documents the admin-add requirement and privacy mode setup
- `/Users/giladkoch/dev/telegram-tmp/telegram/src/telegram/bot.ts` — Configures allowed_updates to include my_chat_member events
- `/Users/giladkoch/dev/telegram-tmp/telegram/src/telegram/handlers.ts` — Contains the my_chat_member handler for group-add detection

## Evidence

- May 19: The developer onboarded to a Telegram BD conversation tracker called Scout by reviewing architect... (27 moments)

## Related

- [Scout bot router architecture](scout-bot-router-architecture.md)
