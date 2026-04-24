require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  PermissionsBitField,
  Events,
  ComponentType,
  REST,
  Routes
} = require('discord.js');

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;
const verifiedRoleId = process.env.VERIFIED_ROLE_ID || null;
const unverifiedRoleId = process.env.UNVERIFIED_ROLE_ID || null;

if (!token || !clientId || !guildId) {
  console.error('Missing DISCORD_TOKEN, CLIENT_ID, or GUILD_ID in .env');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

const voiceStates = new Map();

const CHANNEL_PREFIX = 'tempvoice';
const LOBBY_CHANNEL_ID = '1497294929477505115';
const VERIFICATION_CHANNEL_ID = '1497321024520454245';
const VERIFY_BUTTON_ID = 'verify:button';

async function getLobbyChannel() {
  return client.channels.fetch(LOBBY_CHANNEL_ID).catch(() => null);
}

function findExistingTempVoiceForOwner(ownerId) {
  for (const state of voiceStates.values()) {
    if (state.ownerId === ownerId) {
      return state;
    }
  }
  return null;
}

function getVerifiedRole(guild) {
  if (verifiedRoleId) {
    return guild.roles.cache.get(verifiedRoleId) || null;
  }
  return guild.roles.cache.find(role => role.name.toLowerCase() === 'verified') || null;
}

function getUnverifiedRole(guild) {
  if (unverifiedRoleId) {
    return guild.roles.cache.get(unverifiedRoleId) || null;
  }
  return guild.roles.cache.find(role => ['not verified', 'unverified', 'not verifie'].includes(role.name.toLowerCase())) || null;
}

async function ensureVerificationMessage() {
  const channel = await client.channels.fetch(VERIFICATION_CHANNEL_ID).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const messages = await channel.messages.fetch({ limit: 50 });
  const existing = messages.find(message =>
    message.author.id === client.user.id &&
    message.components.some(row => row.components.some(component => component.customId === VERIFY_BUTTON_ID))
  );

  if (existing) return;

  const verifyEmbed = new EmbedBuilder()
    .setTitle('Verified Role')
    .setDescription('Click the button below to receive the verified role automatically.')
    .setColor(0x57f287);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(VERIFY_BUTTON_ID)
      .setLabel('Verify Me')
      .setStyle(ButtonStyle.Success)
  );

  await channel.send({ embeds: [verifyEmbed], components: [row] });
}

async function createTempVoiceForMember(member, lobbyChannel) {
  const guild = member.guild;
  const channelName = `${member.displayName} voice`;
  const unverifiedRole = getUnverifiedRole(guild);
  const overwrites = [
    {
      id: guild.roles.everyone,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]
    },
    {
      id: member.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]
    }
  ];
  if (unverifiedRole) {
    overwrites.push({
      id: unverifiedRole.id,
      deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]
    });
  }

  const voiceChannel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildVoice,
    parent: lobbyChannel.parentId || undefined,
    bitrate: lobbyChannel.bitrate || undefined,
    userLimit: lobbyChannel.userLimit || 0,
    rtcRegion: lobbyChannel.rtcRegion || null,
    permissionOverwrites: overwrites
  });

  const state = {
    channelId: voiceChannel.id,
    ownerId: member.id,
    private: false,
    waitingRoom: false,
    trusted: new Set(),
    blocked: new Set(),
    userLimit: 0,
    panelChannelId: null,
    panelMessageId: null
  };

  voiceStates.set(voiceChannel.id, state);
  await member.voice.setChannel(voiceChannel);

  const statusEmbed = buildStatusEmbed(voiceChannel, state);
  const components = makeControlRows(voiceChannel.id, state);

  let panelChannel = await guild.channels.create({
    name: `${channelName}-panel`,
    type: ChannelType.GuildText,
    parent: voiceChannel.parentId || undefined,
    topic: `Control panel for ${voiceChannel.name}`,
    permissionOverwrites: [
      {
        id: guild.roles.everyone,
        deny: [PermissionFlagsBits.ViewChannel]
      },
      {
        id: client.user.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages]
      },
      {
        id: member.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
        deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions]
      }
    ]
  });

  const panelMessage = await panelChannel.send({ embeds: [statusEmbed], components });
  state.panelChannelId = panelChannel.id;
  state.panelMessageId = panelMessage.id;

  const commandsEmbed = new EmbedBuilder()
    .setTitle(`This is the start of the ${channelName} voice channel`)
    .setDescription('Use these commands to manage your temp VC:')
    .addFields(
      { name: '.v name', value: 'Rename the voice channel', inline: true },
      { name: '.v limit', value: 'Set max users', inline: true },
      { name: '.v region', value: 'Change the voice region', inline: true },
      { name: '.v privacy', value: 'Lock or unlock the channel', inline: true },
      { name: '.v trust', value: 'Trust a connected user', inline: true },
      { name: '.v untrust', value: 'Remove trusted access', inline: true },
      { name: '.v kick', value: 'Reject a connected user', inline: true },
      { name: '.v unblock', value: 'Allow a rejected user again', inline: true },
      { name: '.v claim', value: 'Claim ownership', inline: true },
      { name: '.v transfer', value: 'Transfer ownership', inline: true },
      { name: '.v delete', value: 'Delete the voice channel', inline: true }
    )
    .setColor(0x57f287);

  await panelChannel.send({
    content: `Welcome <@${member.id}>! Your temp voice channel has been created. Only the owner can rename, set limit, or change the region.`,
    embeds: [commandsEmbed],
    allowedMentions: { users: [member.id] }
  });

  return voiceChannel;
}

async function cleanupTempVoiceChannel(channelId) {
  const state = voiceStates.get(channelId);
  if (!state) return;

  if (state.panelChannelId) {
    const panelChannel = await client.channels.fetch(state.panelChannelId).catch(() => null);
    if (panelChannel?.isTextBased()) {
      await panelChannel.delete('Temp VC panel deleted').catch(() => null);
    }
  }

  voiceStates.delete(channelId);
  const voiceChannel = await client.channels.fetch(channelId).catch(() => null);
  if (voiceChannel) await voiceChannel.delete('Temp voice channel empty');
}

function buildStatusEmbed(channel, state) {
  return new EmbedBuilder()
    .setTitle('Temp Voice Control Panel')
    .setDescription(`Manage your temporary voice channel: **${channel.name}**`)
    .addFields(
      { name: 'Owner', value: `<@${state.ownerId}>`, inline: true },
      { name: 'Limit', value: state.userLimit === 0 ? 'No limit' : `${state.userLimit}`, inline: true },
      { name: 'Lock', value: state.private ? 'Locked' : 'Unlocked', inline: true },
      { name: 'Trusted', value: state.trusted.size ? Array.from(state.trusted).map(id => `<@${id}>`).join(', ') : 'None', inline: false }
    )
    .setColor(0x5865f2)
    .setTimestamp();
}

async function syncPanelChannelPermissions(state, oldOwnerId = null) {
  if (!state.panelChannelId) return;
  const panelChannel = await client.channels.fetch(state.panelChannelId).catch(() => null);
  if (!panelChannel || !panelChannel.isTextBased()) return;

  const overwrites = [
    {
      id: panelChannel.guild.roles.everyone,
      deny: [PermissionFlagsBits.ViewChannel]
    },
    {
      id: client.user.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages]
    },
    {
      id: state.ownerId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
      deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions]
    }
  ];

  for (const trustedId of state.trusted) {
    if (trustedId !== state.ownerId) {
      overwrites.push({
        id: trustedId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
        deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions]
      });
    }
  }

  await panelChannel.permissionOverwrites.set(overwrites, 'Sync temp voice panel access');
}

function makeControlRows(channelId, state) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${CHANNEL_PREFIX}:name:${channelId}`).setLabel('Name').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${CHANNEL_PREFIX}:limit:${channelId}`).setLabel('Limit').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${CHANNEL_PREFIX}:region:${channelId}`).setLabel('Region').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${CHANNEL_PREFIX}:privacy:${channelId}`).setLabel('Lock / Unlock').setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${CHANNEL_PREFIX}:trust:${channelId}`).setLabel('Trust').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${CHANNEL_PREFIX}:untrust:${channelId}`).setLabel('Untrust').setStyle(ButtonStyle.Secondary)
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${CHANNEL_PREFIX}:kick:${channelId}`).setLabel('Reject').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`${CHANNEL_PREFIX}:unblock:${channelId}`).setLabel('Unblock').setStyle(ButtonStyle.Secondary)
  );

  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${CHANNEL_PREFIX}:claim:${channelId}`).setLabel('Claim').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${CHANNEL_PREFIX}:transfer:${channelId}`).setLabel('Transfer').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${CHANNEL_PREFIX}:delete:${channelId}`).setLabel('Delete').setStyle(ButtonStyle.Danger)
  );

  return [row1, row2, row3, row4];
}

function isController(member, state) {
  return member.id === state.ownerId || member.permissions.has(PermissionFlagsBits.ManageChannels);
}

function canPerformAction(member, state, action) {
  if (member.id === state.ownerId) return true;
  const trustedActions = new Set(['trust', 'untrust', 'invite', 'kick', 'block', 'unblock', 'quick-trust', 'quick-invite']);
  return trustedActions.has(action) && state.trusted.has(member.id);
}

async function updatePanelMessage(client, state, text) {
  if (!state.panelChannelId || !state.panelMessageId) return;
  try {
    const channel = await client.channels.fetch(state.panelChannelId);
    if (!channel || !channel.isTextBased()) return;
    const message = await channel.messages.fetch(state.panelMessageId);
    if (!message) return;
    await message.edit({
      embeds: [buildStatusEmbed(await client.channels.fetch(state.channelId), state)],
      components: makeControlRows(state.channelId, state)
    });
  } catch (error) {
    console.warn('Failed to update panel message:', error.message);
  }
}

function buildRegionSelect(channelId) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${CHANNEL_PREFIX}:region:${channelId}`)
      .setPlaceholder('Choose a voice region')
      .addOptions([
        { label: 'Automatic', value: 'automatic' },
        { label: 'US East', value: 'us-east' },
        { label: 'US West', value: 'us-west' },
        { label: 'Brazil', value: 'brazil' },
        { label: 'Europe', value: 'europe' },
        { label: 'Hong Kong', value: 'hongkong' },
        { label: 'India', value: 'india' },
        { label: 'Japan', value: 'japan' },
        { label: 'Singapore', value: 'singapore' }
      ])
  );
}

function buildUserSelect(action, channelId, placeholder) {
  return new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(`${CHANNEL_PREFIX}:${action}:${channelId}`)
      .setPlaceholder(placeholder)
      .setMinValues(1)
      .setMaxValues(1)
  );
}

function buildConnectedVoiceMemberSelect(action, channelId, placeholder, voiceChannel) {
  const options = voiceChannel.members
    .filter(member => !member.user.bot)
    .map(member => ({
      label: member.displayName.slice(0, 100),
      value: member.id
    }))
    .slice(0, 25);

  if (!options.length) return null;

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${CHANNEL_PREFIX}:${action}:${channelId}`)
      .setPlaceholder(placeholder)
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(options)
  );
}

function buildBlockedUserSelect(action, channelId, placeholder, state, guild) {
  const blockedIds = Array.from(state.blocked);
  const options = blockedIds
    .map(id => {
      const member = guild.members.cache.get(id);
      if (!member || member.user.bot) return null;
      return {
        label: member.displayName.slice(0, 100),
        value: id
      };
    })
    .filter(Boolean)
    .slice(0, 25);

  if (!options.length) return null;

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${CHANNEL_PREFIX}:${action}:${channelId}`)
      .setPlaceholder(placeholder)
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(options)
  );
}

async function loadVoiceState(channel) {
  if (!channel || channel.type !== ChannelType.GuildVoice) return null;
  return voiceStates.get(channel.id) || null;
}

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName !== 'tempvoice') return;
      const ownerId = interaction.user.id;
      const guild = interaction.guild;
      const categoryId = interaction.channel?.parentId || null;
      const voiceChannel = await guild.channels.create({
        name: `${interaction.user.username}'s temp`,
        type: ChannelType.GuildVoice,
        parent: categoryId,
        permissionOverwrites: [
          {
            id: guild.roles.everyone,
            allow: [PermissionFlagsBits.Connect]
          }
        ]
      });

      const state = {
        channelId: voiceChannel.id,
        ownerId,
        private: false,
        waitingRoom: false,
        chatEnabled: false,
        textChannelId: null,
        trusted: new Set(),
        blocked: new Set(),
        userLimit: 0,
        panelChannelId: interaction.channel.id,
        panelMessageId: null
      };
      voiceStates.set(voiceChannel.id, state);

      const panel = await interaction.reply({
        embeds: [buildStatusEmbed(voiceChannel, state)],
        components: makeControlRows(voiceChannel.id, state),
        fetchReply: true
      });
      state.panelMessageId = panel.id;
      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId === VERIFY_BUTTON_ID) {
        const guild = interaction.guild;
        if (!guild) {
          await interaction.reply({ content: 'This button can only be used in the server.', ephemeral: true });
          return;
        }

        const role = getVerifiedRole(guild);
        if (!role) {
          await interaction.reply({ content: 'Verified role is not configured on this server.', ephemeral: true });
          return;
        }

        const member = interaction.member || await guild.members.fetch(interaction.user.id).catch(() => null);
        if (!member) {
          await interaction.reply({ content: 'Could not resolve your member information.', ephemeral: true });
          return;
        }

        if (member.roles.cache.has(role.id)) {
          await interaction.reply({ content: 'You are already verified.', ephemeral: true });
          return;
        }

        const unverifiedRole = getUnverifiedRole(guild);
        await member.roles.add(role, 'Verified via button');
        if (unverifiedRole && member.roles.cache.has(unverifiedRole.id)) {
          await member.roles.remove(unverifiedRole, 'Removed unverified role after verification');
        }

        await interaction.reply({ content: `You have been given the **${role.name}** role.`, ephemeral: true });
        return;
      }

      const [prefix, action, channelId] = interaction.customId.split(':');
      if (prefix !== CHANNEL_PREFIX) return;

      const state = voiceStates.get(channelId);
      if (!state) {
        await interaction.reply({ content: 'This temp voice channel is no longer available.', ephemeral: true });
        return;
      }

      const voiceChannel = await client.channels.fetch(channelId);
      if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
        voiceStates.delete(channelId);
        await interaction.reply({ content: 'Channel was deleted or is unavailable.', ephemeral: true });
        return;
      }

      const guild = voiceChannel.guild;
      if (!guild) {
        await interaction.reply({ content: 'Could not determine the guild for this channel.', ephemeral: true });
        return;
      }
      const member = await guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || (!canPerformAction(member, state, action) && action !== 'claim' && action !== 'quick-claim')) {
        await interaction.reply({ content: 'Only the owner or trusted members can use this action.', ephemeral: true });
        return;
      }

      switch (action) {
        case 'name': {
          const modal = new ModalBuilder()
            .setCustomId(`${CHANNEL_PREFIX}:modal-name:${channelId}`)
            .setTitle('Rename Temp Voice Channel');
          const nameInput = new TextInputBuilder()
            .setCustomId('channelName')
            .setLabel('New channel name')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('My temp room');
          modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
          await interaction.showModal(modal);
          return;
        }

        case 'limit': {
          const modal = new ModalBuilder()
            .setCustomId(`${CHANNEL_PREFIX}:modal-limit:${channelId}`)
            .setTitle('Set User Limit');
          const limitInput = new TextInputBuilder()
            .setCustomId('userLimit')
            .setLabel('Max users (0 for unlimited)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('0');
          modal.addComponents(new ActionRowBuilder().addComponents(limitInput));
          await interaction.showModal(modal);
          return;
        }

        case 'region':
        case 'quick-region': {
          await interaction.reply({
            content: 'Select a voice region for the channel.',
            components: [buildRegionSelect(channelId)],
            ephemeral: true
          });
          return;
        }

        case 'privacy': {
          state.private = !state.private;
          const unverifiedRole = getUnverifiedRole(voiceChannel.guild);
          await voiceChannel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
            Connect: !state.private
          });
          if (unverifiedRole) {
            await voiceChannel.permissionOverwrites.edit(unverifiedRole.id, {
              Connect: false,
              ViewChannel: false
            });
          }
          await updatePanelMessage(client, state, 'Lock status updated.');
          await interaction.reply({ content: `Channel is now **${state.private ? 'Locked' : 'Unlocked'}**.`, ephemeral: true });
          return;
        }

        case 'waiting': {
          state.waitingRoom = !state.waitingRoom;
          await updatePanelMessage(client, state, 'Waiting room toggled.');
          await interaction.reply({ content: `Waiting room is now **${state.waitingRoom ? 'enabled' : 'disabled'}**.`, ephemeral: true });
          return;
        }

        case 'chat': {
          await interaction.reply({ content: 'Text chat is disabled for this mode; only the temporary voice channel is created.', ephemeral: true });
          return;
        }

        case 'trust':
        case 'untrust':
        case 'invite':
        case 'kick':
        case 'block':
        case 'unblock':
        case 'transfer':
        case 'quick-trust':
        case 'quick-invite': {
          const placeholderMap = {
            trust: 'Select connected user to trust',
            untrust: 'Select connected user to untrust',
            invite: 'Select user to invite',
            kick: 'Select connected user to reject',
            block: 'Select connected user to block',
            unblock: 'Select user to unblock',
            transfer: 'Select a connected member to transfer ownership',
            'quick-trust': 'Select connected user to trust/untrust',
            'quick-invite': 'Select user to invite/kick'
          };

          const connectedSelectActions = new Set(['trust', 'untrust', 'kick', 'block', 'transfer', 'quick-trust']);

          if (connectedSelectActions.has(action)) {
            const selectRow = buildConnectedVoiceMemberSelect(action, channelId, placeholderMap[action], voiceChannel);
            if (!selectRow) {
              await interaction.reply({ content: 'No connected users are available for this action.', ephemeral: true });
              return;
            }
            await interaction.reply({
              content: 'Choose a connected member to continue.',
              components: [selectRow],
              ephemeral: true
            });
            return;
          }

          if (action === 'unblock') {
            const selectRow = buildBlockedUserSelect(action, channelId, placeholderMap[action], state, voiceChannel.guild);
            if (!selectRow) {
              await interaction.reply({ content: 'No rejected users are available to unblock.', ephemeral: true });
              return;
            }
            await interaction.reply({
              content: 'Choose a rejected user to unblock.',
              components: [selectRow],
              ephemeral: true
            });
            return;
          }

          await interaction.reply({
            content: 'Choose a user to continue.',
            components: [buildUserSelect(action, channelId, placeholderMap[action])],
            ephemeral: true
          });
          return;
        }

        case 'claim':
        case 'quick-claim': {
          const ownersInChannel = voiceChannel.members.has(state.ownerId);
          if (ownersInChannel) {
            await interaction.reply({ content: 'The owner is still present in the channel; claim is only needed when they leave.', ephemeral: true });
            return;
          }
          const previousOwner = state.ownerId;
          state.ownerId = interaction.user.id;
          const panelChannel = await client.channels.fetch(state.panelChannelId).catch(() => null);
          if (panelChannel?.isTextBased()) {
            await panelChannel.permissionOverwrites.edit(interaction.user.id, {
              ViewChannel: true,
              ReadMessageHistory: true,
              SendMessages: false,
              AddReactions: false
            });
            if (previousOwner !== interaction.user.id && !state.trusted.has(previousOwner)) {
              await panelChannel.permissionOverwrites.delete(previousOwner).catch(() => null);
            }
          }
          await updatePanelMessage(client, state, 'Ownership claimed.');
          await interaction.reply({ content: 'You are now the owner of this temp voice channel.', ephemeral: true });
          return;
        }

        case 'delete':
        case 'quick-delete': {
          await interaction.reply({ content: 'Deleting the voice channel and cleaning up state...', ephemeral: true });
          if (state.panelChannelId) {
            const panelChannel = await client.channels.fetch(state.panelChannelId).catch(() => null);
            if (panelChannel?.isTextBased()) await panelChannel.delete('Temp VC panel deleted');
          }
          await voiceChannel.delete('Temp voice channel deleted');
          voiceStates.delete(channelId);
          return;
        }

        default: {
          await interaction.reply({ content: 'Unknown action.', ephemeral: true });
          return;
        }
      }
    }

    if (interaction.isStringSelectMenu()) {
      const [prefix, action, channelId] = interaction.customId.split(':');
      if (prefix !== CHANNEL_PREFIX) return;
      const state = voiceStates.get(channelId);
      if (!state) {
        await interaction.reply({ content: 'This temp voice channel is no longer available.', ephemeral: true });
        return;
      }

      const voiceChannel = await client.channels.fetch(channelId);
      if (!voiceChannel) {
        await interaction.reply({ content: 'Channel is no longer available.', ephemeral: true });
        return;
      }

      if (action === 'region') {
        const selected = interaction.values[0];
        const region = selected === 'automatic' ? null : selected;
        await voiceChannel.edit({ rtcRegion: region });
        await interaction.reply({ content: `Voice region set to **${region || 'Automatic'}**.`, ephemeral: true });
        return;
      }

      const targetId = interaction.values[0];
      const targetMember = await voiceChannel.guild.members.fetch(targetId).catch(() => null);
      if (!targetMember) {
        await interaction.reply({ content: 'Could not find that user in the server.', ephemeral: true });
        return;
      }

      switch (action) {
        case 'kick': {
          const memberVoiceState = targetMember.voice;
          if (memberVoiceState.channelId !== channelId) {
            await interaction.reply({ content: 'That user is no longer connected to this voice channel.', ephemeral: true });
            return;
          }
          await memberVoiceState.disconnect('Rejected from temp voice channel');
          state.blocked.add(targetId);
          await voiceChannel.permissionOverwrites.edit(targetId, { Connect: false });
          await updatePanelMessage(client, state, 'User rejected.');
          await interaction.reply({ content: `<@${targetId}> has been rejected and cannot rejoin this channel until unblocked.`, ephemeral: true });
          return;
        }
        case 'trust': {
          state.trusted.add(targetId);
          await voiceChannel.permissionOverwrites.edit(targetId, { Connect: true });
          const trustPanelChannel = await client.channels.fetch(state.panelChannelId).catch(() => null);
          if (trustPanelChannel?.isTextBased()) {
            await trustPanelChannel.permissionOverwrites.edit(targetId, {
              ViewChannel: true,
              ReadMessageHistory: true,
              SendMessages: false,
              AddReactions: false
            });
          }
          await updatePanelMessage(client, state, 'Trusted user added.');
          await interaction.reply({ content: `<@${targetId}> is now trusted.`, ephemeral: true });
          return;
        }
        case 'untrust': {
          state.trusted.delete(targetId);
          await voiceChannel.permissionOverwrites.edit(targetId, {});
          const untrustPanelChannel = await client.channels.fetch(state.panelChannelId).catch(() => null);
          if (untrustPanelChannel?.isTextBased()) {
            await untrustPanelChannel.permissionOverwrites.delete(targetId).catch(() => null);
          }
          await updatePanelMessage(client, state, 'Trusted user removed.');
          await interaction.reply({ content: `<@${targetId}> is no longer trusted.`, ephemeral: true });
          return;
        }
        case 'block': {
          state.blocked.add(targetId);
          await voiceChannel.permissionOverwrites.edit(targetId, { Connect: false });
          await updatePanelMessage(client, state, 'User blocked.');
          await interaction.reply({ content: `<@${targetId}> is blocked from joining.`, ephemeral: true });
          return;
        }
        case 'transfer': {
          const previousOwner = state.ownerId;
          state.ownerId = targetId;
          const transferPanelChannel = await client.channels.fetch(state.panelChannelId).catch(() => null);
          if (transferPanelChannel?.isTextBased()) {
            await transferPanelChannel.permissionOverwrites.edit(targetId, {
              ViewChannel: true,
              ReadMessageHistory: true,
              SendMessages: false,
              AddReactions: false
            });
            if (previousOwner !== targetId && !state.trusted.has(previousOwner)) {
              await transferPanelChannel.permissionOverwrites.delete(previousOwner).catch(() => null);
            }
          }
          await updatePanelMessage(client, state, 'Ownership transferred.');
          await interaction.reply({ content: `<@${targetId}> is now the owner.`, ephemeral: true });
          return;
        }
        case 'quick-trust': {
          state.trusted.add(targetId);
          await voiceChannel.permissionOverwrites.edit(targetId, { Connect: true });
          const quickTrustPanelChannel = await client.channels.fetch(state.panelChannelId).catch(() => null);
          if (quickTrustPanelChannel?.isTextBased()) {
            await quickTrustPanelChannel.permissionOverwrites.edit(targetId, {
              ViewChannel: true,
              ReadMessageHistory: true,
              SendMessages: false,
              AddReactions: false
            });
          }
          await updatePanelMessage(client, state, 'Trusted user added.');
          await interaction.reply({ content: `<@${targetId}> trusted via quick action.`, ephemeral: true });
          return;
        }
        default: {
          await interaction.reply({ content: 'Unknown action.', ephemeral: true });
          return;
        }
      }
    }

    if (interaction.isUserSelectMenu()) {
      const [prefix, action, channelId] = interaction.customId.split(':');
      if (prefix !== CHANNEL_PREFIX) return;
      const targetId = interaction.values[0];
      const state = voiceStates.get(channelId);
      if (!state) {
        await interaction.reply({ content: 'This temp voice channel is no longer available.', ephemeral: true });
        return;
      }
      const voiceChannel = await client.channels.fetch(channelId);
      if (!voiceChannel) {
        await interaction.reply({ content: 'Channel is no longer available.', ephemeral: true });
        return;
      }
      const guild = voiceChannel.guild;
      if (!guild) {
        await interaction.reply({ content: 'Could not determine the guild for this channel.', ephemeral: true });
        return;
      }
      const targetMember = await guild.members.fetch(targetId).catch(() => null);
      if (!targetMember) {
        await interaction.reply({ content: 'Could not find that user in the server.', ephemeral: true });
        return;
      }

      switch (action) {
        case 'trust': {
          state.trusted.add(targetId);
          await voiceChannel.permissionOverwrites.edit(targetId, { Connect: true });
          const panelChannel = await client.channels.fetch(state.panelChannelId).catch(() => null);
          if (panelChannel?.isTextBased()) {
            await panelChannel.permissionOverwrites.edit(targetId, {
              ViewChannel: true,
              ReadMessageHistory: true,
              SendMessages: false,
              AddReactions: false
            });
          }
          await updatePanelMessage(client, state, 'Trusted user added.');
          await interaction.reply({ content: `<@${targetId}> is now trusted.`, ephemeral: true });
          return;
        }
        case 'untrust': {
          state.trusted.delete(targetId);
          await voiceChannel.permissionOverwrites.edit(targetId, {});
          const panelChannel = await client.channels.fetch(state.panelChannelId).catch(() => null);
          if (panelChannel?.isTextBased()) {
            await panelChannel.permissionOverwrites.delete(targetId).catch(() => null);
          }
          await updatePanelMessage(client, state, 'Trusted user removed.');
          await interaction.reply({ content: `<@${targetId}> is no longer trusted.`, ephemeral: true });
          return;
        }
        case 'invite': {
          await voiceChannel.permissionOverwrites.edit(targetId, { Connect: true });
          await interaction.reply({ content: `<@${targetId}> can now join the channel.`, ephemeral: true });
          return;
        }
        case 'kick': {
          const memberVoiceState = targetMember.voice;
          if (memberVoiceState.channelId !== channelId) {
            await interaction.reply({ content: 'That user is not currently in this voice channel.', ephemeral: true });
            return;
          }
          await memberVoiceState.disconnect('Rejected from temp voice channel');
          state.blocked.add(targetId);
          await voiceChannel.permissionOverwrites.edit(targetId, { Connect: false });
          await updatePanelMessage(client, state, 'User rejected.');
          await interaction.reply({ content: `<@${targetId}> has been rejected and cannot rejoin this channel until unblocked.`, ephemeral: true });
          return;
        }
        case 'block': {
          state.blocked.add(targetId);
          await voiceChannel.permissionOverwrites.edit(targetId, { Connect: false });
          await updatePanelMessage(client, state, 'User blocked.');
          await interaction.reply({ content: `<@${targetId}> is blocked from joining.`, ephemeral: true });
          return;
        }
        case 'unblock': {
          state.blocked.delete(targetId);
          await voiceChannel.permissionOverwrites.edit(targetId, {});
          await updatePanelMessage(client, state, 'User unblocked.');
          await interaction.reply({ content: `<@${targetId}> may now join again.`, ephemeral: true });
          return;
        }
        case 'transfer': {
          const previousOwner = state.ownerId;
          state.ownerId = targetId;
          const panelChannel = await client.channels.fetch(state.panelChannelId).catch(() => null);
          if (panelChannel?.isTextBased()) {
            await panelChannel.permissionOverwrites.edit(targetId, {
              ViewChannel: true,
              ReadMessageHistory: true,
              SendMessages: false,
              AddReactions: false
            });
            if (previousOwner !== targetId && !state.trusted.has(previousOwner)) {
              await panelChannel.permissionOverwrites.delete(previousOwner).catch(() => null);
            }
          }
          await updatePanelMessage(client, state, 'Ownership transferred.');
          await interaction.reply({ content: `<@${targetId}> is now the owner.`, ephemeral: true });
          return;
        }
        case 'quick-trust': {
          state.trusted.add(targetId);
          await voiceChannel.permissionOverwrites.edit(targetId, { Connect: true });
          await updatePanelMessage(client, state, 'Trusted user added.');
          await interaction.reply({ content: `<@${targetId}> trusted via quick action.`, ephemeral: true });
          return;
        }
        case 'quick-invite': {
          await voiceChannel.permissionOverwrites.edit(targetId, { Connect: true });
          await interaction.reply({ content: `<@${targetId}> invited via quick action.`, ephemeral: true });
          return;
        }
        default: {
          await interaction.reply({ content: 'Unknown select action.', ephemeral: true });
          return;
        }
      }
    }

    if (interaction.isModalSubmit()) {
      const [prefix, modal, channelId] = interaction.customId.split(':');
      if (prefix !== CHANNEL_PREFIX) return;
      const state = voiceStates.get(channelId);
      if (!state) {
        await interaction.reply({ content: 'This temp voice channel is no longer available.', ephemeral: true });
        return;
      }
      const voiceChannel = await client.channels.fetch(channelId);
      if (!voiceChannel) {
        await interaction.reply({ content: 'Channel is no longer available.', ephemeral: true });
        return;
      }
      switch (modal) {
        case 'modal-name': {
          const newName = interaction.fields.getTextInputValue('channelName').slice(0, 100);
          await voiceChannel.setName(newName, 'Temp voice channel renamed');
          await updatePanelMessage(client, state, 'Channel renamed.');
          await interaction.reply({ content: `Channel renamed to **${newName}**.`, ephemeral: true });
          return;
        }
        case 'modal-limit': {
          const value = parseInt(interaction.fields.getTextInputValue('userLimit'), 10);
          const limit = Number.isInteger(value) && value >= 0 && value <= 99 ? value : 0;
          state.userLimit = limit;
          await voiceChannel.edit({ userLimit: limit }, 'Temp voice channel user limit updated');
          await updatePanelMessage(client, state, 'User limit updated.');
          await interaction.reply({ content: `User limit set to **${limit === 0 ? 'unlimited' : limit}**.`, ephemeral: true });
          return;
        }
        default: {
          await interaction.reply({ content: 'Unknown modal submission.', ephemeral: true });
          return;
        }
      }
    }
  } catch (error) {
    console.error('Interaction handler error:', error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: 'An error occurred while processing your request.', ephemeral: true });
    } else {
      await interaction.reply({ content: 'An error occurred while processing your request.', ephemeral: true });
    }
  }
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  try {
    if (oldState.channelId && oldState.channelId !== newState.channelId) {
      const oldTemp = voiceStates.get(oldState.channelId);
      if (oldTemp) {
        const oldChannel = await client.channels.fetch(oldState.channelId).catch(() => null);
        if (!oldChannel || oldChannel.members.size === 0) {
          await cleanupTempVoiceChannel(oldState.channelId);
        }
      }
    }

    if (!newState.channelId) return;
    if (newState.member?.user?.bot) return;

    if (newState.channelId === LOBBY_CHANNEL_ID) {
      const member = newState.member || await newState.guild.members.fetch(newState.id).catch(() => null);
      if (!member) {
        console.warn('VoiceStateUpdate: could not resolve member for lobby join');
        return;
      }

      const lobbyChannel = await getLobbyChannel();
      if (!lobbyChannel || lobbyChannel.type !== ChannelType.GuildVoice) {
        console.warn(`Lobby channel ${LOBBY_CHANNEL_ID} not available or not a voice channel`);
        return;
      }
      console.log(`User ${member.user.tag} joined lobby ${lobbyChannel.name}`);
      const existingState = findExistingTempVoiceForOwner(member.id);
      if (existingState) {
        const existingChannel = await client.channels.fetch(existingState.channelId).catch(() => null);
        if (existingChannel) {
          await member.voice.setChannel(existingChannel);
          return;
        }
        voiceStates.delete(existingState.channelId);
      }
      try {
        await createTempVoiceForMember(member, lobbyChannel);
      } catch (error) {
        console.error('Failed to create temp voice channel:', error);
        const systemChannel = newState.guild.systemChannel;
        if (systemChannel?.isTextBased()) {
          await systemChannel.send(`Failed to create temp voice channel for <@${member.id}>: ${error.message}`);
        }
      }
      return;
    }

    const state = voiceStates.get(newState.channelId);
    if (!state || !state.waitingRoom) return;
    if (state.ownerId === newState.id || state.trusted.has(newState.id) || state.blocked.has(newState.id)) return;

    await newState.disconnect('Waiting room approval required');
    const ownerMember = await newState.guild.members.fetch(state.ownerId).catch(() => null);
    if (ownerMember) {
      await ownerMember.send(`A user tried to join your waiting room for ${newState.channel.name}: <@${newState.id}>`).catch(() => null);
    }
  } catch (error) {
    console.error('Voice state update error:', error);
  }
});

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  const lobbyChannel = await getLobbyChannel();
  if (!lobbyChannel) {
    console.warn(`Lobby channel ${LOBBY_CHANNEL_ID} could not be found on ready.`);
  } else {
    console.log(`Using temp VC lobby channel: ${lobbyChannel.id} (${lobbyChannel.name})`);
  }

  await ensureVerificationMessage();
});

client.login(token);
