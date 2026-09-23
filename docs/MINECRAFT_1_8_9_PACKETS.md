# Minecraft Java 1.8.9 Packet Catalog

This is the complete top-level packet catalog used by this proxy's installed
`minecraft-data` / `minecraft-protocol` schema for Minecraft Java Edition 1.8.9.

## Scope and terminology

- **Total packets:** 112.
- **States:** Handshaking (2), Status (4), Login (6), Play (100).
- **Serverbound / C2S:** sent from the Minecraft client to the server.
- **Clientbound / S2C:** sent from the server to the Minecraft client.
- Packet IDs are state- and direction-specific. The same ID can identify different packets in another state or direction.
- `position` is Minecraft's packed block-position type. Entity spawn and teleport coordinates are often fixed-point integers divided by 32.
- `slot` contains an item ID, count, damage value, and optional NBT.
- `entityMetadata` is a typed list controlling entity flags, names, health, poses, and entity-specific state.
- `conditional` means the field exists only for particular action/type values.
- This catalog covers every top-level packet. It does not enumerate every particle ID, entity type, metadata index, plugin channel, or action enum.

The **Proxy relevance** column describes special handling in this repository. All other packets are still forwarded transparently.

This catalog predates removal of Fury's anti-cheat detectors and cosmetic
model. Entries that mention those consumers are historical packet-analysis
notes, not descriptions of active production hooks. Current behavior is defined
by `proxy.js` and its mounted modules.

## Handshaking: Serverbound

| ID | Packet | Type | What it does and when it is triggered | Important fields | Proxy relevance |
|---|---|---|---|---|---|
| `0x00` | `set_protocol` | Connection | First modern-protocol packet. Selects Status or Login and tells the endpoint which protocol, hostname, and port the client requested. | `protocolVersion`, `serverHost`, `serverPort`, `nextState` | Used by `minecraft-protocol` to establish the downstream and upstream connection state. |
| `0xFE` | `legacy_server_list_ping` | Legacy status | Old pre-1.7 server-list ping. Triggered by legacy clients or scanners instead of the modern Status sequence. | `payload` | Normally handled by the protocol library rather than application packet listeners. |

There are no clientbound packets in the Handshaking state.

## Status: Serverbound

| ID | Packet | Type | What it does and when it is triggered | Important fields | Proxy relevance |
|---|---|---|---|---|---|
| `0x00` | `ping_start` | Status query | Requests the server-list status response after the handshake selected Status. | None | Used when Minecraft refreshes the multiplayer server list. |
| `0x01` | `ping` | Latency | Sends an arbitrary timestamp/value after receiving server information. The server echoes it to measure list-ping latency. | `time` | Separate from Play-state keep-alives and gameplay ping. |

## Status: Clientbound

| ID | Packet | Type | What it does and when it is triggered | Important fields | Proxy relevance |
|---|---|---|---|---|---|
| `0x00` | `server_info` | Status response | Returns the server-list JSON containing MOTD, version, player counts, sample players, and optional favicon. | `response` | The local proxy server supplies its own status/MOTD. |
| `0x01` | `ping` | Latency | Echoes the serverbound Status ping value so the client can calculate round-trip time. | `time` | Used only for server-list latency. |

## Login: Serverbound

| ID | Packet | Type | What it does and when it is triggered | Important fields | Proxy relevance |
|---|---|---|---|---|---|
| `0x00` | `login_start` | Authentication | Begins login after the handshake selected Login. Carries the requested profile name. | `username` | Starts the proxy's authenticated Minecraft session. |
| `0x01` | `encryption_begin` | Encryption | Client response to the encryption request. Contains the RSA-encrypted shared secret and verification token. | `sharedSecret`, `verifyToken` | Handled by `minecraft-protocol` and Microsoft session authentication. |

## Login: Clientbound

| ID | Packet | Type | What it does and when it is triggered | Important fields | Proxy relevance |
|---|---|---|---|---|---|
| `0x00` | `disconnect` | Connection | Rejects login and displays a JSON chat reason before Play begins. | `reason` | Used for authentication failures, bans, version errors, and server rejection. |
| `0x01` | `encryption_begin` | Encryption | Requests encrypted login by sending the server ID, public key, and random verification token. | `serverId`, `publicKey`, `verifyToken` | Handled internally by the protocol/authentication stack. |
| `0x02` | `success` | Authentication | Confirms the authenticated UUID and username and transitions the connection to Play. | `uuid`, `username` | Marks successful upstream and downstream login. |
| `0x03` | `compress` | Compression | Enables packet compression and defines the minimum uncompressed packet size. | `threshold` | Handled by the protocol stream before later packets are decoded. |

## Play: Serverbound

| ID | Packet | Type | What it does and when it is triggered | Important fields | Proxy relevance |
|---|---|---|---|---|---|
| `0x00` | `keep_alive` | Connection | Echoes a server keep-alive ID. Sent periodically after the server requests it; missing replies cause timeout. | `keepAliveId` | Forwarded immediately to minimize proxy-added latency. |
| `0x01` | `chat` | Chat / command | Sends player chat or a slash command when the player submits the chat box. | `message` | Local proxy commands are intercepted; normal messages are forwarded upstream. |
| `0x02` | `use_entity` | Combat / interaction | Interacts with, attacks, or precisely interacts at a point on an entity. Triggered by left/right clicking an entity. | `target`, `mouse`, optional `x`, `y`, `z` | Core combat evidence for reach, attacks, and interaction analysis. |
| `0x03` | `flying` | Movement | Movement heartbeat containing only grounded state. Sent when position and rotation are unchanged. | `onGround` | Indicates client tick movement cadence and ground claims. |
| `0x04` | `position` | Movement | Reports player coordinates when position changed but view rotation did not. | `x`, `y`, `z`, `onGround` | Tracks the observer position and feeds anti-cheat movement state. |
| `0x05` | `look` | Movement | Reports yaw and pitch when view rotation changed but position did not. | `yaw`, `pitch`, `onGround` | Useful for aim/rotation analysis and observer orientation. |
| `0x06` | `position_look` | Movement | Reports coordinates and view rotation together when both changed. | `x`, `y`, `z`, `yaw`, `pitch`, `onGround` | Tracks observer movement and rotation for anti-cheat and preview anchoring. |
| `0x07` | `block_dig` | World interaction | Starts, cancels, or finishes block digging; also represents dropping items and releasing use-item actions. | `status`, `location`, `face` | Useful for mining, release-use, and block-interaction checks. |
| `0x08` | `block_place` | World / item use | Places a block or uses the held item on a block/air. Sent on right click. | `location`, `direction`, `heldItem`, `cursorX`, `cursorY`, `cursorZ` | Detects the player's wood skin and supplies scaffold/block-place evidence. |
| `0x09` | `held_item_slot` | Inventory | Changes the selected hotbar slot when the player scrolls or presses a hotbar key. | `slotId` | Useful for weapon/block selection and combat timing. |
| `0x0A` | `arm_animation` | Animation / combat | Announces the local arm swing. Triggered by left click, attack swings, and some interactions. | None | Attack/swing timing evidence for anti-cheat. |
| `0x0B` | `entity_action` | Player state | Changes sneaking, sprinting, sleeping, horse jumping, or related player actions. | `entityId`, `actionId`, `jumpBoost` | Important for scaffold sneak timing, sprint resets, and movement checks. |
| `0x0C` | `steer_vehicle` | Vehicle | Reports sideways/forward vehicle controls plus jump/dismount flags while riding. | `sideways`, `forward`, `jump` | Allows vehicle movement to be separated from ordinary player movement. |
| `0x0D` | `close_window` | Inventory | Tells the server that the player closed an inventory/container GUI. | `windowId` | Clears cosmetic-preview GUI tracking. |
| `0x0E` | `window_click` | Inventory | Performs a click, shift-click, number-key swap, drag, drop, or double-click in an open window. | `windowId`, `slot`, `mouseButton`, `action`, `mode`, `item` | Detects Hypixel cosmetic Preview clicks and tracks GUI interaction. Watched and synthesised by the `/menudebug` menu monitor. |
| `0x0F` | `transaction` | Inventory acknowledgement | Confirms or rejects a server transaction after an inventory action. | `windowId`, `action`, `accepted` | Maintains inventory synchronization when a click was rejected. `/menudebug` answers these on the client's behalf for clicks it synthesised. |
| `0x10` | `set_creative_slot` | Creative inventory | Directly writes an inventory slot or drops an item while in Creative mode. | `slot`, `item` | Normally absent in Hypixel survival minigames; suspicious if accepted outside Creative. |
| `0x11` | `enchant_item` | Inventory | Chooses one of the displayed enchantment options in an enchanting table. | `windowId`, `enchantment` | Relevant only while an enchanting GUI is open. |
| `0x12` | `update_sign` | World interaction | Submits the four edited sign lines after the player closes the sign editor. | `location`, `text1`-`text4` | Forwarded; can carry player-authored text. |
| `0x13` | `abilities` | Player abilities | Reports client ability flags and movement speeds, commonly when flight state changes. | `flags`, `flyingSpeed`, `walkingSpeed` | Helps distinguish legitimate flight/ability states from movement anomalies. |
| `0x14` | `tab_complete` | Commands | Requests command/chat completion for the current text, optionally at a block position. | `text`, optional `block` | Local proxy commands provide their own completion results. |
| `0x15` | `settings` | Client configuration | Sends locale, render distance, chat settings, colors, and visible skin parts after joining or changing options. | `locale`, `viewDistance`, `chatFlags`, `chatColors`, `skinParts` | Forwarded as client preferences. |
| `0x16` | `client_command` | Player lifecycle | Sends a client status action such as respawn or opening statistics. | `payload` | Respawn action is relevant after death. |
| `0x17` | `custom_payload` | Plugin channel | Sends arbitrary plugin-channel data such as brand or mod/server extension messages. | `channel`, `data` | Forwarded opaquely unless a feature explicitly handles the channel. |
| `0x18` | `spectate` | Spectator | Requests teleportation to the target UUID while in Spectator mode. | `target` | Normally used by spectator controls, not regular BedWars/SkyWars play. |
| `0x19` | `resource_pack_receive` | Resource pack | Reports accepted, declined, downloaded, or failed status for a server resource pack. | `hash`, `result` | Response to `resource_pack_send`. |

## Play: Clientbound

| ID | Packet | Type | What it does and when it is triggered | Important fields | Proxy relevance |
|---|---|---|---|---|---|
| `0x00` | `keep_alive` | Connection | Periodically asks the client to echo an ID to prove the connection is alive and measure latency. | `keepAliveId` | Forwarded immediately to avoid adding latency. |
| `0x01` | `login` | World initialization | First Play packet. Assigns the client's entity ID and initial game mode, dimension, difficulty, capacity, and level type. | `entityId`, `gameMode`, `dimension`, `difficulty`, `maxPlayers`, `levelType`, `reducedDebugInfo` | Seeds the anti-cheat observer entity and session state. |
| `0x02` | `chat` | Chat / action bar | Displays JSON chat. `position` distinguishes normal/system chat from the action bar. | `message`, `position` | Drives game detection, cosmetic triggers, chat overlays, commands, and notifications. |
| `0x03` | `update_time` | World | Updates total world age and time of day, normally every second. | `age`, `time` | Forwarded; rarely needed by current features. |
| `0x04` | `entity_equipment` | Entity / inventory | Changes an entity's held item or armor slot. Sent on equipment changes and entity initialization. | `entityId`, `slot`, `item` | Anti-cheat uses equipment to understand swords, blocks, armor, and combat context. |
| `0x05` | `spawn_position` | World | Sets the world spawn/compass target. Sent on join and when spawn changes. | `location` | World-state information. |
| `0x06` | `update_health` | Player state | Updates the local player's health, food, and saturation after damage, healing, or hunger changes. | `health`, `food`, `foodSaturation` | Can indicate death/damage timing but is not another player's health feed. |
| `0x07` | `respawn` | World / lifecycle | Reinitializes dimension, difficulty, game mode, and level type after death or dimension change. | `dimension`, `difficulty`, `gamemode`, `levelType` | Resets anti-cheat/world tracking and match-sensitive state. |
| `0x08` | `position` | Movement correction | Teleports or corrects the local player. Flags indicate relative versus absolute coordinates/rotation. | `x`, `y`, `z`, `yaw`, `pitch`, `flags` | Updates observer location and cosmetic preview anchors; must not be treated as voluntary movement. |
| `0x09` | `held_item_slot` | Inventory | Forces the local client's selected hotbar slot. | `slot` | Server-authoritative counterpart to the serverbound slot change. |
| `0x0A` | `bed` | Entity state | Makes a player entity enter the sleeping animation at a bed location. | `entityId`, `location` | Despite its name, this is sleeping state, not a BedWars bed-destruction event. |
| `0x0B` | `animation` | Entity animation | Plays an entity animation such as arm swing, hurt, wake, critical hit, or magic critical. | `entityId`, `animation` | Anti-cheat uses attack/animation timing; routine copies are excluded from cosmetic capture. |
| `0x0C` | `named_entity_spawn` | Entity spawn | Spawns another player entity with UUID, position, rotation, held item, and metadata. | `entityId`, `playerUUID`, `x`, `y`, `z`, `yaw`, `pitch`, `currentItem`, `metadata` | Establishes player/entity identity and initial anti-cheat position. |
| `0x0D` | `collect` | Entity / item | Animates one entity, usually an item or XP orb, being collected by another. | `collectedEntityId`, `collectorEntityId` | Included as possible cosmetic entity-lifecycle evidence. |
| `0x0E` | `spawn_entity` | Entity spawn | Spawns non-living objects such as items, projectiles, TNT, falling blocks, fireballs, and fireworks. | `entityId`, `type`, `x`, `y`, `z`, `pitch`, `yaw`, `objectData`, optional `velocity` | Strong cosmetic signal and projectile/combat context. |
| `0x0F` | `spawn_entity_living` | Entity spawn | Spawns a mob or other living entity with position, rotation, velocity, and metadata. | `entityId`, `type`, `x`, `y`, `z`, `yaw`, `pitch`, `headPitch`, `velocity`, `metadata` | Strong cosmetic signal for pig, squid, guardian, golem, bat, and similar effects. |
| `0x10` | `spawn_entity_painting` | Entity spawn | Spawns a painting with its motive, block position, and facing. | `entityId`, `title`, `location`, `direction` | Forwarded; uncommon in minigames. |
| `0x11` | `spawn_entity_experience_orb` | Entity spawn | Spawns an XP orb at fixed-point coordinates with an XP value. | `entityId`, `x`, `y`, `z`, `count` | Used by cosmetics that emit XP orbs. |
| `0x12` | `entity_velocity` | Entity movement | Applies server-authoritative velocity/knockback to an entity. | `entityId`, `velocity` | Critical anti-cheat context for knockback, speed, flight, and combat; routine copies are excluded from cosmetic capture. |
| `0x13` | `entity_destroy` | Entity lifecycle | Removes one or more entities from the client's world. | `entityIds` | Ends player and cosmetic entity tracking; useful for effect lifecycle signatures. |
| `0x14` | `entity` | Entity heartbeat | Sends a no-delta entity update, mainly preserving synchronization/on-ground semantics in the protocol. | `entityId` | Low-information movement packet, generally forwarded. |
| `0x15` | `rel_entity_move` | Entity movement | Moves an entity by small fixed-point byte deltas without changing rotation. | `entityId`, `dX`, `dY`, `dZ`, `onGround` | Main observer-side movement source for other players and anti-cheat. |
| `0x16` | `entity_look` | Entity movement | Updates entity yaw/pitch without position movement. | `entityId`, `yaw`, `pitch`, `onGround` | Rotation/aim evidence; excluded from cosmetic recording as routine combat noise. |
| `0x17` | `entity_move_look` | Entity movement | Applies small relative movement and rotation in one packet. | `entityId`, `dX`, `dY`, `dZ`, `yaw`, `pitch`, `onGround` | Main movement/rotation anti-cheat input; excluded from cosmetic recording as routine noise. |
| `0x18` | `entity_teleport` | Entity movement | Sets an entity to an absolute fixed-point position and rotation when relative deltas are insufficient or the server teleports it. | `entityId`, `x`, `y`, `z`, `yaw`, `pitch`, `onGround` | Important for blink/lag analysis, position recovery, and effect entities. |
| `0x19` | `entity_head_rotation` | Entity movement | Rotates an entity's head independently of its body. | `entityId`, `headYaw` | Adds aim/head orientation context. |
| `0x1A` | `entity_status` | Entity state | Emits a compact status event such as hurt, death, tame, particles, or permission state. | `entityId`, `entityStatus` | Anti-cheat and cosmetic logic can use hurt/death timing. |
| `0x1B` | `attach_entity` | Entity relationship | Mounts/dismounts an entity or creates/removes a leash relationship. | `entityId`, `vehicleId`, `leash` | Separates vehicle-driven movement from ordinary movement. |
| `0x1C` | `entity_metadata` | Entity state | Replaces selected metadata entries controlling flags and entity-specific state. | `entityId`, `metadata` | Used for blocking/item-use state, invisibility, names, and anti-cheat context; routine copies are excluded from cosmetics. |
| `0x1D` | `entity_effect` | Potion effect | Adds or updates a potion/status effect on an entity. | `entityId`, `effectId`, `amplifier`, `duration`, `hideParticles` | Allows anti-cheat to account for Speed, Jump Boost, and other legitimate modifiers. |
| `0x1E` | `remove_entity_effect` | Potion effect | Removes one potion/status effect from an entity. | `entityId`, `effectId` | Ends the corresponding anti-cheat movement allowance. |
| `0x1F` | `experience` | Player state | Updates the local player's XP bar, level, and total XP. | `experienceBar`, `level`, `totalExperience` | Forwarded; distinct from spawning XP-orb entities. |
| `0x20` | `update_attributes` | Entity state | Updates entity attributes and modifiers, including movement speed, attack damage, health, and knockback-related values. | `entityId`, `properties` | Potential source of legitimate movement/combat modifiers. |
| `0x21` | `map_chunk` | World data | Loads, updates, or unloads one chunk column depending on flags and data. | `x`, `z`, `groundUp`, `bitMap`, `chunkData` | Anti-cheat tracks loaded-world context; large packet that should remain off hot-path logging. |
| `0x22` | `multi_block_change` | World data | Applies multiple block-state changes inside one chunk. | `chunkX`, `chunkZ`, `records` | Supplies world updates and possible cosmetic block effects. |
| `0x23` | `block_change` | World data | Changes one block state at an exact position. | `location`, `type` | Detects bed changes, placements, scaffold context, and cosmetic anchors. |
| `0x24` | `block_action` | World effect | Triggers a block-specific action such as note block, piston, chest, or beacon animation. | `location`, `byte1`, `byte2`, `blockId` | Captured as a possible cosmetic/world signal. |
| `0x25` | `block_break_animation` | World effect | Displays progressive block cracking for an entity at a block position; stage clears when out of range. | `entityId`, `location`, `destroyStage` | Mining and block-interaction context. |
| `0x26` | `map_chunk_bulk` | World data | Sends many chunk columns in one packet, commonly on join or large movement/teleport. | `skyLightSent`, `meta`, `data` | Anti-cheat tracks chunk availability; expensive payload should not be deeply copied. |
| `0x27` | `explosion` | World / movement | Creates an explosion, removes affected blocks, and applies local-player motion. | `x`, `y`, `z`, `radius`, `affectedBlockOffsets`, `playerMotionX/Y/Z` | Strong cosmetic signal and legitimate velocity/explosion context. |
| `0x28` | `world_event` | World effect | Plays a numbered global/local world event such as block break, record, smoke, potion splash, or eye effect. | `effectId`, `location`, `data`, `global` | Cosmetic classifier records event ID/data signatures. |
| `0x29` | `named_sound_effect` | Sound | Plays a named sound at fixed-point coordinates with volume and pitch. | `soundName`, `x`, `y`, `z`, `volume`, `pitch` | Strong spatial cosmetic feature and gameplay feedback signal. |
| `0x2A` | `world_particles` | Particle | Spawns particles with position, offsets, speed/data, count, range mode, and optional particle-specific arguments. | `particleId`, `longDistance`, `x`, `y`, `z`, `offsetX/Y/Z`, `particleData`, `particles`, optional `data` | One of the strongest cosmetic-preview and in-game cosmetic signals. |
| `0x2B` | `game_state_change` | World / game state | Changes a client game-state reason such as rain, game mode, demo messages, credits, or reduced debug state. | `reason`, `gameMode` | Forwarded; reason controls the interpretation of the float value. |
| `0x2C` | `spawn_entity_weather` | Entity spawn / weather | Spawns a weather entity, normally lightning, at fixed-point coordinates. | `entityId`, `type`, `x`, `y`, `z` | Very strong Lightning cosmetic signature. |
| `0x2D` | `open_window` | Inventory | Opens a chest, hopper, villager, horse, or custom inventory GUI. | `windowId`, `inventoryType`, `windowTitle`, `slotCount`, optional `entityId` | Starts Hypixel cosmetic GUI and Preview tracking, and opens a tracked window in the `/menudebug` monitor. |
| `0x2E` | `close_window` | Inventory | Forces an open inventory/container GUI to close. | `windowId` | Clears tracked cosmetic GUI state. |
| `0x2F` | `set_slot` | Inventory | Updates one inventory/window slot, including cursor and player inventory special window IDs. | `windowId`, `slot`, `item` | Keeps cosmetic menu item/NBT state current and updates the `/menudebug` slot model. |
| `0x30` | `window_items` | Inventory | Replaces the complete contents of an inventory window. | `windowId`, `items` | Supplies cosmetic names, lore, and Preview controls to the GUI tracker and to the `/menudebug` slot model. |
| `0x31` | `craft_progress_bar` | Inventory | Updates a window property such as furnace progress/fuel, enchantment data, or beacon values. | `windowId`, `property`, `value` | Forwarded; meaning depends on inventory type. |
| `0x32` | `transaction` | Inventory acknowledgement | Accepts or rejects a client inventory action number. | `windowId`, `action`, `accepted` | Keeps inventory state synchronized after `window_click`; `/menudebug` swallows the replies to its own synthetic clicks. |
| `0x33` | `update_sign` | World data | Updates the four visible JSON/text lines of a sign. | `location`, `text1`-`text4` | Forwarded; may display server-controlled text. |
| `0x34` | `map` | Item data | Updates map scale, icons, and optionally a rectangular pixel region. | `itemDamage`, `scale`, `icons`, `columns`, optional `rows`, `x`, `y`, `data` | Used for held map rendering. |
| `0x35` | `tile_entity_data` | World data / NBT | Updates a block entity such as chest, beacon, skull, flower pot, or command block. | `location`, `action`, `nbtData` | Carries potentially large structured NBT. |
| `0x36` | `open_sign_entity` | Inventory / text UI | Opens the sign editor for the sign at the supplied block position. | `location` | Causes a later serverbound `update_sign`. |
| `0x37` | `statistics` | Player data | Sends one or more statistic/achievement counters, often after the client requests statistics or a value changes. | `entries` | Forwarded; entries contain statistic names and values. |
| `0x38` | `player_info` | Player list | Adds/removes tab-list players or updates game mode, latency, and display name. | `action`, `data` | Central to roster, UUID/name, ping, nick, tab stats, overlay, and anti-cheat identity tracking. |
| `0x39` | `abilities` | Player abilities | Sets local ability flags plus flying and walking speed. | `flags`, `flyingSpeed`, `walkingSpeed` | Authoritative allowance for flight and altered movement speed. |
| `0x3A` | `tab_complete` | Commands | Returns completion strings for the client's latest request. | `matches` | Proxy can replace results for locally handled commands. |
| `0x3B` | `scoreboard_objective` | Scoreboard | Creates, removes, or updates an objective and its rendering type. | `name`, `action`, optional `displayText`, `type` | Used for gamemode/lobby/game-state detection. |
| `0x3C` | `scoreboard_score` | Scoreboard | Adds/updates or removes one score entry from an objective. | `itemName`, `action`, `scoreName`, optional `value` | Reconstructs sidebar lines for game-state and mode detection. |
| `0x3D` | `scoreboard_display_objective` | Scoreboard | Assigns an objective to list, sidebar, or below-name display slot. | `position`, `name` | Identifies the active sidebar objective. |
| `0x3E` | `scoreboard_team` | Scoreboard / teams | Creates, removes, updates, or changes membership of a team with prefix, suffix, color, and visibility rules. | `team`, `mode`, conditional team properties and `players` | Core BedWars team, roster, tab-display, nick, and anti-cheat mapping source. |
| `0x3F` | `custom_payload` | Plugin channel | Sends arbitrary server plugin-channel data to the client. | `channel`, `data` | Forwarded opaquely unless a channel is explicitly supported. |
| `0x40` | `kick_disconnect` | Connection | Terminates an active Play connection and displays a JSON reason. | `reason` | Ends proxy session and triggers state/data flushing. |
| `0x41` | `difficulty` | World state | Changes the client's displayed world difficulty. | `difficulty` | Forwarded; may change after dimension/world transitions. |
| `0x42` | `combat_event` | Combat | Reports enter-combat, end-combat, or entity-death events with event-specific fields and optional death message. | `event`, optional `duration`, `playerId`, `entityId`, `message` | Useful for precise combat/death lifecycle tracking. |
| `0x43` | `camera` | Spectator | Changes which entity the client camera follows while spectating. | `cameraId` | Distinguishes observer camera movement from normal player movement. |
| `0x44` | `world_border` | World state | Initializes or updates border size, center, interpolation, warning time, or warning distance. | `action` and action-specific radius/center/speed/warning fields | Forwarded; action controls which fields are present. |
| `0x45` | `title` | UI | Displays/updates title or subtitle text, timing, clear, or reset actions. | `action`, optional `text`, `fadeIn`, `stay`, `fadeOut` | Common for minigame countdowns and status announcements. |
| `0x46` | `set_compression` | Compression | Changes the compression threshold while already in Play. This is unusual because compression is normally set during Login. | `threshold` | Handled by the protocol stream. |
| `0x47` | `playerlist_header` | Player list UI | Sets JSON header and footer text above/below the tab player list. | `header`, `footer` | Forwarded; may contain server, mode, stats, and branding text. |
| `0x48` | `resource_pack_send` | Resource pack | Offers or requires a resource pack by URL and hash. | `url`, `hash` | Causes a later serverbound `resource_pack_receive` status. |
| `0x49` | `update_entity_nbt` | Entity state / NBT | Replaces or updates structured NBT associated with an entity. | `entityId`, `tag` | Rare, potentially large entity data; forwarded transparently. |

## Counts and coverage

| State | Serverbound | Clientbound | Total |
|---|---:|---:|---:|
| Handshaking | 2 | 0 | 2 |
| Status | 2 | 2 | 4 |
| Login | 2 | 4 | 6 |
| Play | 26 | 74 | 100 |
| **Total** | **32** | **80** | **112** |

## Practical packet groups

- **Connection and latency:** `set_protocol`, encryption/login packets, `keep_alive`, compression, disconnect packets.
- **Local movement:** serverbound `flying`, `position`, `look`, and `position_look`; clientbound `position` is a correction/teleport.
- **Observed entity movement:** `rel_entity_move`, `entity_move_look`, `entity_look`, `entity_teleport`, `entity_velocity`, and head rotation.
- **Combat:** `use_entity`, arm/entity animations, status, equipment, metadata, potion effects, velocity, and `combat_event`.
- **World/block state:** chunk packets, block changes/actions, breaking, explosion, world events, particles, sounds, and weather entities.
- **Inventory/GUI:** open/close window, slot/window contents, clicks, transactions, properties, creative slots, and enchanting.
- **Player identity and teams:** `player_info` and scoreboard team/objective/score/display packets.
- **Extension data:** serverbound/clientbound `custom_payload` packets are plugin-defined and require channel-specific decoding.

## Source of truth

Packet IDs, names, directions, states, and field names were taken from the locally installed
Minecraft 1.8.9 protocol schema:

`node_modules/minecraft-data/minecraft-data/data/pc/1.8/proto.yml`

The runtime packet names are the names emitted by `minecraft-protocol`, so they can be compared
directly with `meta.name` in `proxy.js`.
