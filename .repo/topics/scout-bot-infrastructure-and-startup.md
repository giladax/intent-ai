# Scout bot infrastructure and startup

Scout requires PostgreSQL (via Docker), Prisma migrations, and a running bot process. The startup sequence is: spin up Postgres, run Prisma migration, start the bot. The project was pre-configured with working credentials enabling zero-setup deployment. The bot confirms end-to-end functionality by processing commands during startup.

## behavior

- The required startup sequence is: Postgres via Docker → Prisma migration → bot process start. All three steps must complete before the bot is functional.
- The bot confirms end-to-end functionality during startup by processing any queued Telegram commands — a /briefing command was processed and returned a 722-char response during the first startup.

## risk

- Exit code 254 errors and timeout failures during startup are artifacts of killed/old bot instances, not the current process — the bot may appear to fail while actually running successfully.

## Files

- `/Users/giladkoch/dev/telegram-tmp/telegram/src/index.ts` — Bot entry point — starts the process after infrastructure is ready
- `/Users/giladkoch/dev/telegram-tmp/telegram/src/telegram/bot.ts` — Bot configuration and long-polling setup

## Evidence

- May 19: The developer onboarded to a Telegram BD conversation tracker called Scout by reviewing architect... (27 moments)

## Related

- [Scout bot router architecture](scout-bot-router-architecture.md)
- [Scout bot Telegram group support](scout-bot-telegram-group-support.md)
