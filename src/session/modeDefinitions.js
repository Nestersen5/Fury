'use strict';

const MODE_DEFINITIONS = [
    {
        key: 'Bedwars',
        mode: 'BEDWARS',
        label: 'BedWars',
        fields: {
            wins: 'wins_bedwars',
            losses: 'losses_bedwars',
            kills: 'kills_bedwars',
            deaths: 'deaths_bedwars',
            finals: 'final_kills_bedwars',
            finalDeaths: 'final_deaths_bedwars',
            beds: 'beds_broken_bedwars',
            bedsLost: 'beds_lost_bedwars',
            games: 'games_played_bedwars',
            experience: 'Experience'
        }
    },
    {
        key: 'SkyWars',
        mode: 'SKYWARS',
        label: 'SkyWars',
        fields: {
            wins: 'wins',
            losses: 'losses',
            kills: 'kills',
            deaths: 'deaths',
            assists: 'assists',
            games: 'games'
        }
    },
    {
        key: 'Duels',
        mode: 'DUELS',
        label: 'Duels',
        fields: {
            wins: 'wins',
            losses: 'losses',
            kills: 'kills',
            deaths: 'deaths',
            games: 'games_played_duels'
        }
    }
];

module.exports = { MODE_DEFINITIONS };
