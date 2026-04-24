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
