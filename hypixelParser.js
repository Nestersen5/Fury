const axios = require('axios');

class HypixelParser {
    constructor(backendUrl = 'http://localhost:8000') {
        this.backendUrl = backendUrl;
        
        // Regex Patterns based exactly on your provided examples
        this.patterns = {
            // BED DESTRUCTION > Green Bed was bed #17,863 destroyed by ilysleevle!
            bedBreak: /^BED DESTRUCTION > (\w+) Bed was bed #([\d,]+) destroyed by (\w+)!/,
            
            // VukarioWasHacked was ilysleevle's final #44,497. FINAL KILL!
            finalKill: /^(\w+) was (\w+)'s final #([\d,]+)\. FINAL KILL!/,
            
            // <player> has joined (1/16)!
            queueJoin: /^(\w+) has joined \(\d+\/\d+\)!/,
            
            // TEAM ELIMINATED > Green Team has been eliminated!
            teamEliminated: /^TEAM ELIMINATED > (\w+) Team has been eliminated!/,
            
            // Protect your bed and destroy the enemy beds.
            matchStart: /^Protect your bed and destroy the enemy beds\./,
            
            // Game ends (Usually a line like "1st Killer - " or "Bed Wars")
            // This is a simple generic catch for match end
            matchEnd: /^\s*Bed Wars\s*$/i 
        };
    }

    /**
     * Extracts pure plain text from a 1.8.9 chat JSON component
     * and strips all § color codes.
     */
    cleanChatComponent(jsonString) {
        try {
            const component = JSON.parse(jsonString);
            let text = "";

            const traverse = (node) => {
                if (typeof node === 'string') {
                    text += node;
                } else if (typeof node === 'object' && node !== null) {
                    if (node.text) text += node.text;
                    if (node.extra) node.extra.forEach(traverse);
                }
            };

            traverse(component);
            
            // Strip Minecraft color codes (e.g. §a, §l, §r)
            return text.replace(/§[0-9a-fk-or]/ig, '').trim();
        } catch (e) {
            return "";
        }
    }

    /**
     * Main entry point for chat packets
     */
    handleChatPacket(packet) {
        if (!packet.message) return;
        
        const cleanText = this.cleanChatComponent(packet.message);
        if (!cleanText) return;

        this.parseMessage(cleanText);
    }

    /**
     * Checks the clean text against our Hypixel regex patterns
     */
    parseMessage(text) {
        // 1. Bed Break
        const bedMatch = text.match(this.patterns.bedBreak);
        if (bedMatch) {
            console.log(`[PARSER] Bed Break: ${bedMatch[1]} by ${bedMatch[3]}`);
            this.sendEvent('bed_break', {
                team: bedMatch[1].toLowerCase(),
                player: bedMatch[3],
                totalBeds: parseInt(bedMatch[2].replace(/,/g, ''))
            });
            return;
        }

        // 2. Final Kill
        const finalMatch = text.match(this.patterns.finalKill);
        if (finalMatch) {
            console.log(`[PARSER] Final Kill: ${finalMatch[2]} killed ${finalMatch[1]}`);
            this.sendEvent('final_kill', {
                victim: finalMatch[1],
                killer: finalMatch[2],
                totalFinals: parseInt(finalMatch[3].replace(/,/g, ''))
            });
            return;
        }

        // 3. Queue Join
        const joinMatch = text.match(this.patterns.queueJoin);
        if (joinMatch) {
            const player = joinMatch[1];
            console.log(`[PARSER] Player Joined: ${player}`);
            // Send to the player_join endpoint so the backend performs a Denick check
            this.sendPlayerJoin(player);
            return;
        }

        // 4. Team Eliminated
        const elimMatch = text.match(this.patterns.teamEliminated);
        if (elimMatch) {
            console.log(`[PARSER] Team Eliminated: ${elimMatch[1]}`);
            this.sendEvent('team_elimination', { team: elimMatch[1].toLowerCase() });
            return;
        }

        // 5. Match Start
        if (this.patterns.matchStart.test(text)) {
            console.log(`[PARSER] Match Started!`);
            this.sendEvent('game_start', {});
            return;
        }
        
        // (Optional) Print clean chat for debugging missing messages
        // console.log(`[CHAT] ${text}`);
    }

    /**
     * Sends generic events to Python backend
     */
    async sendEvent(type, data) {
        try {
            await axios.post(`${this.backendUrl}/api/proxy/chat`, {
                type: type,
                data: data
            });
        } catch (error) {
            console.error(`[PARSER] Failed to send ${type} to backend:`, error.message);
        }
    }

    /**
     * Triggers the denick API in the Python backend
     */
    async sendPlayerJoin(nickname) {
        try {
            await axios.post(`${this.backendUrl}/api/proxy/player_join`, {
                nickname: nickname,
                teamColor: "gray" // We mock gray until we extract real team colors from tab list
            });
        } catch (error) {
            console.error(`[PARSER] Failed to trigger denick for ${nickname}:`, error.message);
        }
    }
}

module.exports = HypixelParser;