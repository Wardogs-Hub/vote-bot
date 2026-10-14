// WardogsHub vote reward bot.
// Members run /claimvote. The bot asks WardogsHub whether their Discord account
// voted for your server today, and gives them a role if it did.
import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { Client, GatewayIntentBits, MessageFlags } from 'discord.js';

const { DISCORD_TOKEN, GUILD_ID, ROLE_ID, WARDOGSHUB_API_KEY, VOTE_URL } = process.env;
const ROLE_HOURS = Number(process.env.ROLE_HOURS ?? 24); // 0 = never remove the role
const API = 'https://wardogshub.gg/api/v1/votes/check';
// Where claim times are kept. Override with CLAIMS_FILE (the Docker image uses /data).
const CLAIMS_FILE = process.env.CLAIMS_FILE || new URL('./claims.json', import.meta.url);

for (const [name, value] of Object.entries({ DISCORD_TOKEN, GUILD_ID, ROLE_ID, WARDOGSHUB_API_KEY, VOTE_URL })) {
  if (!value) { console.error(`Missing ${name} in .env`); process.exit(1); }
}

// claims.json maps a Discord user ID to the time (ms) their role was given.
const claims = existsSync(CLAIMS_FILE) ? JSON.parse(readFileSync(CLAIMS_FILE, 'utf8')) : {};
const saveClaims = () => writeFileSync(CLAIMS_FILE, JSON.stringify(claims, null, 2));

// Ask WardogsHub if this Discord account has voted today.
async function checkVote(discordId) {
  const res = await fetch(`${API}?discord_id=${discordId}`, {
    headers: { Authorization: `Bearer ${WARDOGSHUB_API_KEY}` },
  });
  if (!res.ok) {
    const err = new Error(`API returned ${res.status}`);
    err.status = res.status;
    err.retryAfter = res.headers.get('Retry-After');
    throw err;
  }
  return res.json();
}

// Only the Guilds intent is needed: slash commands do not read messages.
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('clientReady', async () => {
  // Register /claimvote for your server only, so it appears straight away.
  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.commands.set([{ name: 'claimvote', description: 'Claim your vote reward role' }]);
  console.log(`Ready as ${client.user.tag}`);
});

// One check per member per 30 seconds, so nobody can spam /claimvote and use
// up your API limit (120 checks a minute) for everyone else.
const COOLDOWN_MS = 30 * 1000;
const lastUse = new Map();

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'claimvote') return;
  // Only the member sees the replies.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const now = Date.now();
  if (now - (lastUse.get(interaction.user.id) ?? 0) < COOLDOWN_MS) {
    await interaction.editReply('Give it 30 seconds before trying again.');
    return;
  }
  lastUse.set(interaction.user.id, now);

  try {
    const result = await checkVote(interaction.user.id);
    if (result.voted) {
      await interaction.member.roles.add(ROLE_ID);
      claims[interaction.user.id] = Date.now();
      saveClaims();
      await interaction.editReply('Vote found. Your reward role has been added. Thanks for voting!');
    } else {
      await interaction.editReply(`No vote found for your Discord account today. Vote here: ${VOTE_URL}`);
    }
  } catch (err) {
    console.error('claimvote failed:', err);
    if (err.status === 429) {
      await interaction.editReply(`Lots of people are claiming right now. Try again in ${err.retryAfter ?? 'a minute'} seconds.`);
    } else {
      await interaction.editReply('Something went wrong checking your vote. Please try again in a few minutes.');
    }
  }
});

// Every hour, remove the role from anyone whose claim is older than ROLE_HOURS.
async function sweep() {
  if (!ROLE_HOURS) return;
  const cutoff = Date.now() - ROLE_HOURS * 3600 * 1000;
  const guild = await client.guilds.fetch(GUILD_ID);
  for (const [userId, claimedAt] of Object.entries(claims)) {
    if (claimedAt > cutoff) continue;
    try {
      const member = await guild.members.fetch(userId);
      await member.roles.remove(ROLE_ID);
    } catch (err) {
      console.error(`Could not remove role from ${userId}:`, err.message); // e.g. they left the server
    }
    delete claims[userId];
  }
  saveClaims();
}
setInterval(() => sweep().catch((e) => console.error('sweep failed:', e)), 60 * 60 * 1000);

client.login(DISCORD_TOKEN);
