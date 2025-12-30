/**
 * Helper utilities for interacting with the ERLCClient.
 * Mirrors the ergonomics provided by erlc.ts's PRCHelpers.
 */

class PRCHelpers {
  /**
   * @param {import('./client').ERLCClient} client
   */
  constructor(client) {
    this.client = client;
  }

  async findPlayer(nameOrId) {
    const players = await this.client.getPlayers();
    const lowerQuery = String(nameOrId || '').toLowerCase();
    if (!lowerQuery) return null;

    return (
      players.find((p) =>
        String(p.Player || '')
          .toLowerCase()
          .includes(lowerQuery)
      ) || null
    );
  }

  async getPlayersByTeam(team) {
    const players = await this.client.getPlayers();
    const lowerTeam = String(team || '').toLowerCase();
    return players.filter(
      (p) => String(p.Team || '').toLowerCase() === lowerTeam
    );
  }

  async getStaffPlayers() {
    const players = await this.client.getPlayers();
    return players.filter((p) => p.Permission && p.Permission !== 'Normal');
  }

  async getOnlineCount() {
    const status = await this.client.getServerStatus();
    return status.CurrentPlayers;
  }

  async isServerFull() {
    const status = await this.client.getServerStatus();
    return status.CurrentPlayers >= status.MaxPlayers;
  }

  async sendMessage(message) {
    await this.client.executeCommand(`:h ${message}`);
  }

  async sendPM(player, message) {
    await this.client.executeCommand(`:pm ${player} ${message}`);
  }

  async kickPlayer(player, reason) {
    const cmd = reason ? `:kick ${player} ${reason}` : `:kick ${player}`;
    await this.client.executeCommand(cmd);
  }

  async banPlayer(player, reason) {
    const cmd = reason ? `:ban ${player} ${reason}` : `:ban ${player}`;
    await this.client.executeCommand(cmd);
  }

  async teleportPlayer(player, target) {
    await this.client.executeCommand(`:tp ${player} ${target}`);
  }

  async setTeam(player, team) {
    await this.client.executeCommand(`:team ${player} ${team}`);
  }

  async getRecentJoins(minutes = 10) {
    const logs = await this.client.getJoinLogs();
    const cutoff = Date.now() / 1000 - minutes * 60;
    return logs.filter((log) => log.Join && log.Timestamp > cutoff);
  }

  async getRecentLeaves(minutes = 10) {
    const logs = await this.client.getJoinLogs();
    const cutoff = Date.now() / 1000 - minutes * 60;
    return logs.filter((log) => !log.Join && log.Timestamp > cutoff);
  }

  async getPlayerKills(player, hours = 1) {
    const logs = await this.client.getKillLogs();
    const cutoff = Date.now() / 1000 - hours * 3600;
    const lowerPlayer = String(player || '').toLowerCase();
    return logs.filter(
      (log) =>
        String(log.Killer || '')
          .toLowerCase()
          .includes(lowerPlayer) && log.Timestamp > cutoff
    );
  }

  async getPlayerDeaths(player, hours = 1) {
    const logs = await this.client.getKillLogs();
    const cutoff = Date.now() / 1000 - hours * 3600;
    const lowerPlayer = String(player || '').toLowerCase();
    return logs.filter(
      (log) =>
        String(log.Killed || '')
          .toLowerCase()
          .includes(lowerPlayer) && log.Timestamp > cutoff
    );
  }

  async getPlayerCommands(player, hours = 1) {
    const logs = await this.client.getCommandLogs();
    const cutoff = Date.now() / 1000 - hours * 3600;
    const lowerPlayer = String(player || '').toLowerCase();
    return logs.filter(
      (log) =>
        String(log.Player || '')
          .toLowerCase()
          .includes(lowerPlayer) && log.Timestamp > cutoff
    );
  }

  async getUnansweredModCalls(hours = 1) {
    const logs = await this.client.getModCalls();
    const cutoff = Date.now() / 1000 - hours * 3600;
    return logs.filter((log) => !log.Moderator && log.Timestamp > cutoff);
  }

  async waitForPlayer(nameOrId, timeoutMs = 30000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const player = await this.findPlayer(nameOrId);
      if (player) return player;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(`Player ${nameOrId} not found within timeout`);
  }

  async waitForPlayerCount(count, timeoutMs = 60000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const currentCount = await this.getOnlineCount();
      if (currentCount >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error(`Server did not reach ${count} players within timeout`);
  }

  formatPlayer(player) {
    const split = String(player || '').split(':');
    if (split.length !== 2) {
      throw new Error(`Invalid player format: ${player}. Expected "Name:ID"`);
    }
    return { Name: split[0], ID: split[1] };
  }

  formatTimestamp(timestamp) {
    return new Date(timestamp * 1000).toLocaleString();
  }

  formatUptime(startTimestamp) {
    const uptimeMs = Date.now() - startTimestamp * 1000;
    const hours = Math.floor(uptimeMs / (1000 * 60 * 60));
    const minutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  }

  async kickAllFromTeam(team, reason) {
    const players = await this.getPlayersByTeam(team);
    if (players.length === 0) return [];

    const userNames = players
      .map((p) => {
        try {
          return this.formatPlayer(p.Player).Name;
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    if (userNames.length > 0) {
      const cmd = reason
        ? `:kick ${userNames.join(',')} ${reason}`
        : `:kick ${userNames.join(',')}`;
      await this.client.executeCommand(cmd);
    }

    return players.map((p) => p.Player);
  }

  async messageAllStaff(message) {
    const staff = await this.getStaffPlayers();
    if (staff.length === 0) return;

    const userNames = staff
      .map((p) => {
        try {
          return this.formatPlayer(p.Player).Name;
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    if (userNames.length > 0) {
      await this.client.executeCommand(`:pm ${userNames.join(',')} ${message}`);
    }
  }

  async getServerStats(hours = 24) {
    const cutoff = Date.now() / 1000 - hours * 3600;

    const [status, joinLogs, killLogs, commandLogs, modCalls] =
      await Promise.all([
        this.client.getServerStatus(),
        this.client.getJoinLogs(),
        this.client.getKillLogs(),
        this.client.getCommandLogs(),
        this.client.getModCalls(),
      ]);

    const recentJoins = joinLogs.filter(
      (log) => log.Join && log.Timestamp > cutoff
    );
    const recentKills = killLogs.filter((log) => log.Timestamp > cutoff);
    const recentCommands = commandLogs.filter((log) => log.Timestamp > cutoff);
    const recentModCalls = modCalls.filter((log) => log.Timestamp > cutoff);

    return {
      current: {
        players: status.CurrentPlayers,
        maxPlayers: status.MaxPlayers,
        name: status.Name,
        owner: status.OwnerId,
      },
      recent: {
        joins: recentJoins.length,
        kills: recentKills.length,
        commands: recentCommands.length,
        modCalls: recentModCalls.length,
        uniquePlayers: new Set(recentJoins.map((log) => log.Player)).size,
      },
    };
  }
}

module.exports = {
  PRCHelpers,
};
