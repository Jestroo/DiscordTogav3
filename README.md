# DiscordTogav2

DiscordTogav2 is a lightweight, production-ready Discord bot for creating and managing temporary voice channels, verification flows, and self-assignable role panels. It focuses on reliability, clear permission handling, and an intuitive owner control panel for each temporary voice channel.

Key features
- Temporary voice channels with owner control panels (lock, limit, transfer, delete)
- Verification message and automatic verified role assignment
- Self-assignable game role panel (autoroles) with toggle buttons
- Permission-aware handling for unverified users and trusted actions

Requirements
- Node.js 18+ (or the version specified in package.json)
- A Discord Bot application and token with necessary guild permissions

Configuration
Create a `.env` file in the project root (DO NOT commit this file). Typical variables:

- `DISCORD_TOKEN` — your bot token (keep secret)
- `CLIENT_ID` — the bot application client ID
- `GUILD_ID` — the target guild ID
- `VERIFIED_ROLE_ID` — (optional) role ID to treat as verified
- `UNVERIFIED_ROLE_ID` — (optional) role ID to treat as unverified
- `AUTO_ROLES_CHANNEL_ID` — (optional) channel ID to post autoroles panel

Installation
```bash
npm install
```

Run locally
```bash
# ensure .env is present
npm start
```

Deployment
- Use a process manager (PM2, systemd) or containerization for production.
- Store secrets in environment-specific secret stores (GitHub Secrets, Docker secrets, cloud provider secrets).

Security
- Never commit `.env` or tokens to the repository. If a token is exposed, rotate it immediately and remove it from history.

Contributing
- Fork the repo, create a branch, and open a pull request. Keep changes scoped and document behavior.

Where to look in the code
- Runtime and control panel behavior: `src/index.js`
- Command registration: `src/deploy-commands.js`

License
- MIT

If you'd like, I can also add usage examples, screenshots of the control panel, or a sample `docker-compose` for deployment.
# Temp Voice Discord Bot

A Discord bot that creates temporary voice channels with an interactive control panel for:

- Rename voice channel
- Set user limit
- Change region
- Toggle public/private
- Waiting room approval
- Linked text chat
- Trust/untrust users
- Invite/kick users
- Block/unblock users
- Transfer or claim ownership
- Delete the channel

## Setup

1. Copy `.env.example` to `.env`.
2. Fill `DISCORD_TOKEN`, `CLIENT_ID`, and `GUILD_ID`.
3. Install dependencies:

```bash
npm install
```

4. Register the slash command:

```bash
npm run deploy
```

5. Start the bot:

```bash
npm start
```

## Usage

Use `/tempvoice` in a server text channel to create a controlled temporary voice channel. The bot sends a panel with buttons for every feature.

Alternatively, join the voice channel named `Tap To Create VC` (channel ID `1497294929477505115`) to automatically spawn a temporary VC named `<username> voice` and receive the control panel in the linked chat.

Only the VC owner can rename the channel, set the user limit, or change the region.

### Quick controls

- `Name` → Rename the voice channel
- `Limit` → Set max users
- `Region` → Change voice region
- `Privacy` → Public/private toggle
- `Waiting Room` → Enables approval flow
- `Chat` → Enable/disable linked text chat
- `Trust` / `Untrust` → Manage trusted users
- `Invite` / `Kick` → Invite or remove users
- `Block` / `Unblock` → Block or unblock users from joining
- `Claim` → Take ownership if the original owner leaves
- `Transfer` → Move ownership to someone else
- `Delete` → Remove the temporary voice channel

## Notes

- The command is registered to the guild specified by `GUILD_ID`.
- This bot keeps state in memory and works best for short-lived voice channels.
