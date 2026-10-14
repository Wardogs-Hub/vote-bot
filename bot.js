// WardogsHub vote reward bot.
// Two ways to get the reward role:
//  1. Automatic: every few minutes the bot asks WardogsHub who has voted lately
//     and gives the role to anyone in your server.
//  2. /claimvote: a member asks the bot to check their own vote.
import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { Client, GatewayIntentBits, MessageFlags } from 'discord.js';

const { DISCORD_TOKEN, GUILD_ID, ROLE_ID, WARDOGSHUB_API_KEY, VOTE_URL } = process.env;
const ROLE_HOURS = Number(process.env.ROLE_HOURS ?? 24); // 0 = never remove the role
const AUTO_POLL_MINUTES = Number(process.env.AUTO_POLL_MINUTES ?? 5); // 0 = automatic mode off
const API = 'https://wardogshub.gg/api/v1/votes';
const HOUR_MS = 3600 * 1000;
// Where claim times are kept. Override with CLAIMS_FILE (the Docker image uses /data).
const CLAIMS_FILE = process.env.CLAIMS_FILE || new URL('./claims.json', import.meta.url);

for (const [name, value] of Object.entries({ DISCORD_TOKEN, GUILD_ID, ROLE_ID, WARDOGSHUB_API_KEY, VOTE_URL })) {
  if (!value) { console.error(`Missing ${name} in .env`); process.exit(1); }
}

// claims.json maps a Discord user ID to the time (ms) of the vote that earned their role.
const claims = existsSync(CLAIMS_FILE) ? JSON.parse(readFileSync(CLAIMS_FILE, 'utf8')) : {};
const saveClaims = () => writeFileSync(CLAIMS_FILE, JSON.stringify(claims, null, 2));

// Call the WardogsHub API and return the JSON. Errors carry .status and .retryAfter.
async function apiGet(url) {
  const res = await fetch(url, {
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

// Ask WardogsHub if this Discord account has voted today.
const checkVote = (discordId) => apiGet(`${API}/check?discord_id=${discordId}`);

// Everyone who voted since the given time, following the pages until the end.
async function fetchVoters(since) {
  const voters = [];
  let cursor = null;
  do {
    const page = await apiGet(`${API}?since=${encodeURIComponent(since.toISOString())}&limit=500${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    voters.push(...page.voters);
    cursor = page.next_cursor;
  } while (cursor);
  return voters;
}

// Only the Guilds intent is needed: slash commands do not read messages.
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('clientReady', async () => {
  // Register /claimvote for your server only, so it appears straight away.
  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.commands.set([{ name: 'claimvote', description: 'Claim your vote reward role' }]);
  console.log(`Ready as ${client.user.tag}`);
  if (AUTO_POLL_MINUTES > 0) {
    setTimeout(runPoll, 10 * 1000); // once shortly after start, then on a timer
    setInterval(runPoll, AUTO_POLL_MINUTES * 60 * 1000);
  }
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
      // Use the real vote time so /claimvote and automatic mode agree.
      claims[interaction.user.id] = result.last_vote_at ? Date.parse(result.last_vote_at) : Date.now();
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

// Automatic mode: give the role to recent voters who are in your server.
// Fetching one member by ID goes over Discord's REST API, so the privileged
// "server members" intent is not needed.
let lastPoll = null;
let polling = false;

async function poll() {
  const started = Date.now();
  const since = lastPoll ?? new Date(started - (ROLE_HOURS || 24) * HOUR_MS);
  const voters = await fetchVoters(since);
  const guild = await client.guilds.fetch(GUILD_ID);
  let given = 0;
  for (const { discord_id: id, last_vote_at } of voters) {
    const votedAt = Date.parse(last_vote_at);
    if (ROLE_HOURS && votedAt + ROLE_HOURS * HOUR_MS <= started) continue; // reward already over
    if ((claims[id] ?? 0) >= votedAt) continue; // already handled
    try {
      const member = await guild.members.fetch(id);
      await member.roles.add(ROLE_ID);
      claims[id] = votedAt;
      given++;
    } catch (err) {
      if (err.code === 10007) continue; // Unknown Member: not in your server, skip quietly
      console.error(`Could not give the role to ${id}:`, err.message);
    }
  }
  if (given) saveClaims();
  lastPoll = new Date(started - 2 * 60 * 1000); // 2 minutes of overlap, so no vote slips through
  console.log(`Poll done: ${voters.length} voters, ${given} new roles`);
}

// Never let a failed poll crash the bot: log it and try again next time.
async function runPoll() {
  if (polling) return;
  polling = true;
  try {
    await poll();
  } catch (err) {
    if (err.status === 429) console.warn(`Poll skipped: rate limited (retry after ${err.retryAfter ?? '?'}s)`);
    else console.error('Poll failed, will retry:', err.message);
  } finally {
    polling = false;
  }
}

// Every hour, remove the role once a claim is older than ROLE_HOURS.
async function sweep() {
  if (!ROLE_HOURS) return;
  const cutoff = Date.now() - ROLE_HOURS * HOUR_MS;
  const guild = await client.guilds.fetch(GUILD_ID);
  for (const [userId, votedAt] of Object.entries(claims)) {
    if (votedAt > cutoff) continue; // role runs until the vote time + ROLE_HOURS
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
setInterval(() => sweep().catch((e) => console.error('sweep failed:', e)), HOUR_MS);

client.login(DISCORD_TOKEN);
