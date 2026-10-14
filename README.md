# WardogsHub vote reward bot

A small Discord bot that gives a role to members who voted for your server on WardogsHub. It works in two ways:

- **Automatic.** Every few minutes the bot asks WardogsHub who has voted for your server and gives the role to anyone who is in your Discord server. Members get the role within a few minutes of voting and do not have to do anything. This only reaches members who are in your Discord server.
- **`/claimvote`.** A member runs the command and the bot checks their own vote. This is handy for people who voted before they joined, or if you turn automatic mode off.

Full API docs: https://wardogshub.gg/servers/vote-rewards/

You need Node 18 or newer, or Docker.

## Setup

1. **Create the application.** Go to https://discord.com/developers/applications, click New Application, then open the Bot tab and click Reset Token. Copy the token. Keep it private.
2. **Invite the bot.** In OAuth2 > URL Generator tick the scopes `bot` and `applications.commands`, and the bot permission Manage Roles. Open the generated URL and add the bot to your server.
3. **Order the roles.** In Server Settings > Roles, drag the bot's role above the reward role. Discord will not let a bot hand out a role that sits higher than its own.
4. **Get your API key.** Sign in at wardogshub.gg with the Discord account that submitted your listing, open /servers/mine/, click Edit on your approved listing, then Generate key under "Vote rewards API". The key is shown once. If your listing was added by us and has no owner account, contact us at https://wardogshub.gg/contact/ to claim it.
5. **Fill in the settings.** Clone this repository, copy `.env.example` to `.env` and fill in each value. Turn on Developer Mode in Discord (Settings > Advanced) to copy server and role IDs.
6. **Run it.**

   ```
   git clone https://github.com/Wardogs-Hub/vote-bot.git
   cd vote-bot
   cp .env.example .env   # then fill it in
   npm install
   npm start
   ```

   When it prints "Ready as ...", vote for your server and the role should arrive within a few minutes (or type `/claimvote` to check straight away).

## Settings

| Variable | What it is |
| --- | --- |
| `DISCORD_TOKEN` | Bot token from the Developer Portal |
| `GUILD_ID` | Your Discord server ID |
| `ROLE_ID` | The role given to voters |
| `WARDOGSHUB_API_KEY` | Your `wdh_` key |
| `VOTE_URL` | Your server page on WardogsHub |
| `ROLE_HOURS` | Hours the role lasts, counted from the vote. Default 24, 0 = never removed |
| `AUTO_POLL_MINUTES` | Minutes between automatic vote checks. Default 5, 0 = automatic mode off (`/claimvote` only) |
| `CLAIMS_FILE` | Optional. Where claim times are saved. Default `claims.json` next to `bot.js` |

## Run with Docker

```
docker build -t wardogshub-vote-bot .
docker run -d --name vote-bot --restart unless-stopped --env-file .env -v vote-bot-data:/data wardogshub-vote-bot
```

Claim times live in the `vote-bot-data` volume, so they survive restarts and upgrades.

## Where to host it

Any machine that stays switched on: a small VPS, a home server or a Raspberry Pi. Run it under a process manager such as pm2 or systemd so it restarts after a crash. Hosts that put apps to sleep are a poor fit: the bot has to stay connected to Discord, and automatic rewards, `/claimvote` and role removal stop while it is asleep.

Claim times are kept in `claims.json` (see `CLAIMS_FILE`). Keep that file when you move the bot, or members who already claimed will keep the role.

## Keep your key secret

Never post the key in Discord, put it in a client app or commit `.env` to a public repository. If it leaks, replace it on /servers/mine/ and the old key stops working at once.

## Rules

Rewards for voting are fine. Do not require a vote to join or play on your server, do not pay for votes and do not use alt accounts. We may revoke keys or remove listings that break these rules.

## Updating

```
git pull
npm install
```

Then restart the bot. With Docker, rebuild the image and recreate the container.

## Licence

MIT. Issues and pull requests are welcome.
